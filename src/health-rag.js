/**
 * RemindMe AI — Health Knowledge RAG Engine
 * Retrieval-Augmented Generation for on-device health knowledge.
 *
 * Architecture:
 * ┌────────────────────┐
 * │  health-kb/*.json  │  ← 6 knowledge docs shipped with the app
 * │  (bundled in /public)
 * └────────┬───────────┘
 *          │ fetch + parse at first use
 *          ▼
 * ┌────────────────────┐
 * │  In-memory index   │  ← tag → chunk mapping, keyword scoring
 * │  (healthKBIndex)   │
 * └────────┬───────────┘
 *          │ query with user question
 *          ▼
 * ┌────────────────────┐
 * │  Top-K chunks      │  ← most relevant knowledge chunks
 * │  (max ~1500 tokens)│  ← fits in Gemma 2B context window
 * └────────┬───────────┘
 *          │ injected into prompt
 *          ▼
 * ┌────────────────────┐
 * │  Gemma 2B model    │  ← generates informed answer
 * └────────────────────┘
 *
 * This is a lightweight text-search RAG (no embeddings needed)
 * optimised for on-device use with limited compute.
 */

// ====================================================
// Knowledge Base Index
// ====================================================

const KB_FILES = [
    'health-kb/bmi_weight_height.json',
    'health-kb/water_hydration.json',
    'health-kb/calories_nutrition.json',
    'health-kb/sleep_quality.json',
    'health-kb/sunlight_vitamin_d.json',
    'health-kb/exercise_activity.json',
];

// All chunks across all documents, loaded once
let allChunks = [];
let kbLoaded = false;

/**
 * Load all knowledge base documents into memory.
 * Called once at app startup. Safe to call multiple times.
 */
export async function loadHealthKB() {
    if (kbLoaded) return;

    const loadPromises = KB_FILES.map(async (file) => {
        try {
            const resp = await fetch(file);
            if (!resp.ok) {
                console.warn(`Health KB: Failed to load ${file}`, resp.status);
                return [];
            }
            const doc = await resp.json();
            // Flatten chunks, attaching parent doc metadata
            return (doc.chunks || []).map(chunk => ({
                docId: doc.id,
                docTitle: doc.title,
                docSource: doc.source,
                docTags: doc.tags || [],
                chunkId: chunk.id,
                chunkTitle: chunk.title,
                content: chunk.content,
                // Pre-compute lowercase searchable text for scoring
                _searchText: (
                    (doc.tags || []).join(' ') + ' ' +
                    chunk.title + ' ' +
                    chunk.content
                ).toLowerCase(),
            }));
        } catch (e) {
            console.warn(`Health KB: Error loading ${file}`, e);
            return [];
        }
    });

    const results = await Promise.all(loadPromises);
    allChunks = results.flat();
    kbLoaded = true;
    console.log(`📚 Health KB loaded: ${allChunks.length} chunks from ${KB_FILES.length} documents`);
}

// ====================================================
// Query / Retrieval
// ====================================================

// Common stop words to filter out of queries
const STOP_WORDS = new Set([
    'i', 'me', 'my', 'am', 'is', 'are', 'was', 'were', 'be', 'been',
    'the', 'a', 'an', 'and', 'or', 'but', 'if', 'of', 'at', 'by',
    'for', 'to', 'in', 'on', 'it', 'its', 'do', 'did', 'does',
    'has', 'have', 'had', 'can', 'could', 'will', 'would', 'should',
    'what', 'how', 'much', 'many', 'when', 'where', 'who',
    'this', 'that', 'these', 'those', 'not', 'no', 'so', 'too',
    'just', 'about', 'with', 'from', 'into', 'some', 'any',
    'tell', 'know', 'need', 'want', 'please', 'help', 'give',
    'hey', 'hi', 'hello', 'amma', 'today', 'right', 'now',
]);

// Synonym mapping to expand query coverage
const SYNONYMS = {
    'hydration': ['water', 'drink', 'fluid', 'hydrate'],
    'water': ['hydration', 'drink', 'fluid', 'dehydration'],
    'weight': ['bmi', 'kg', 'obesity', 'overweight', 'fat', 'thin', 'heavy', 'light'],
    'food': ['meal', 'eat', 'calories', 'kcal', 'nutrition', 'diet', 'breakfast', 'lunch', 'dinner'],
    'eat': ['food', 'meal', 'calories', 'diet', 'breakfast', 'lunch', 'dinner'],
    'calories': ['kcal', 'food', 'energy', 'meal', 'diet'],
    'sleep': ['rest', 'tired', 'insomnia', 'bed', 'nap', 'fatigue'],
    'tired': ['sleep', 'fatigue', 'rest', 'exhausted', 'energy'],
    'sun': ['sunlight', 'vitamin', 'outdoor', 'uv', 'tan'],
    'sunlight': ['sun', 'vitamin', 'outdoor', 'uv'],
    'vitamin': ['sunlight', 'supplement', 'nutrient'],
    'exercise': ['workout', 'gym', 'running', 'walking', 'steps', 'fit', 'cardio', 'activity'],
    'walk': ['walking', 'steps', 'exercise', 'activity'],
    'height': ['tall', 'cm', 'short', 'bmi'],
    'age': ['old', 'young', 'years'],
    'breakfast': ['morning', 'meal', 'food', 'eat'],
    'lunch': ['afternoon', 'meal', 'food', 'eat'],
    'dinner': ['evening', 'night', 'meal', 'food', 'eat'],
    'healthy': ['health', 'wellness', 'fit', 'good'],
    'skin': ['sunlight', 'melanin', 'fitzpatrick', 'burn', 'tan'],
    'sitting': ['sedentary', 'chair', 'desk', 'inactive'],
};

/**
 * Extract meaningful keywords from a user query.
 */
function extractKeywords(query) {
    const words = query.toLowerCase()
        .replace(/[^a-z0-9\s]/g, '')
        .split(/\s+/)
        .filter(w => w.length > 1 && !STOP_WORDS.has(w));

    // Expand with synonyms (add related terms)
    const expanded = new Set(words);
    for (const word of words) {
        const syns = SYNONYMS[word];
        if (syns) {
            syns.forEach(s => expanded.add(s));
        }
    }

    return Array.from(expanded);
}

/**
 * Score a chunk against a set of keywords.
 * Uses term frequency with title boost.
 */
function scoreChunk(chunk, keywords) {
    let score = 0;
    const searchText = chunk._searchText;
    const titleLower = chunk.chunkTitle.toLowerCase();

    for (const kw of keywords) {
        // Title match (higher weight — the chunk is specifically about this topic)
        if (titleLower.includes(kw)) {
            score += 3;
        }

        // Tag match (document-level relevance)
        if (chunk.docTags.includes(kw)) {
            score += 2;
        }

        // Content match (basic term frequency)
        const regex = new RegExp(kw, 'g');
        const matches = searchText.match(regex);
        if (matches) {
            // Cap content score per keyword to avoid biasing long documents
            score += Math.min(matches.length, 5);
        }
    }

    return score;
}

/**
 * Retrieve the top-K most relevant knowledge chunks for a query.
 * Returns formatted text ready for prompt injection.
 *
 * @param {string} query - The user's question
 * @param {number} maxChunks - Maximum chunks to return (default 3)
 * @param {number} maxTokens - Approximate token limit for output (default ~1500)
 * @returns {string} Formatted knowledge context string
 */
export function retrieveHealthKnowledge(query, maxChunks = 3, maxTokens = 1500) {
    if (!kbLoaded || allChunks.length === 0) {
        return '';
    }

    const keywords = extractKeywords(query);
    if (keywords.length === 0) return '';

    // Score all chunks
    const scored = allChunks.map(chunk => ({
        ...chunk,
        score: scoreChunk(chunk, keywords),
    }));

    // Sort by score descending, take top K
    scored.sort((a, b) => b.score - a.score);
    const topChunks = scored.filter(c => c.score > 0).slice(0, maxChunks);

    if (topChunks.length === 0) return '';

    // Build context string with approximate token budgeting
    let context = 'HEALTH KNOWLEDGE BASE (sourced from NIH, CDC, WHO — NOT medical advice):\n\n';
    let approxTokens = 30; // header

    for (const chunk of topChunks) {
        const chunkText = `[${chunk.chunkTitle}] (Source: ${chunk.docSource})\n${chunk.content}\n\n`;
        const chunkTokens = Math.ceil(chunkText.length / 4); // rough token estimate

        if (approxTokens + chunkTokens > maxTokens) {
            // Truncate the last chunk to fit
            const remainingChars = (maxTokens - approxTokens) * 4;
            if (remainingChars > 200) {
                context += chunkText.substring(0, remainingChars) + '...\n\n';
            }
            break;
        }

        context += chunkText;
        approxTokens += chunkTokens;
    }

    return context.trim();
}

/**
 * Get a personalised health context string based on user profile data.
 * This combines the user's personal data WITH relevant KB knowledge.
 *
 * @param {object} profile - User health profile from DB
 * @param {string} query - The user's question
 * @returns {string} Combined context for the AI prompt
 */
export function getPersonalisedHealthContext(profile, query) {
    // Build user-specific context
    let userContext = '';

    if (profile && Object.keys(profile).length > 0) {
        userContext = 'USER HEALTH PROFILE:\n';

        if (profile.age) userContext += `- Age: ${profile.age} years\n`;
        if (profile.gender) userContext += `- Gender: ${profile.gender}\n`;
        if (profile.heightCm) userContext += `- Height: ${profile.heightCm} cm\n`;
        if (profile.weightKg) userContext += `- Weight: ${profile.weightKg} kg\n`;
        if (profile.heightCm && profile.weightKg) {
            const bmi = (profile.weightKg / Math.pow(profile.heightCm / 100, 2)).toFixed(1);
            userContext += `- BMI: ${bmi}\n`;
        }
        if (profile.activityLevel) userContext += `- Activity Level: ${profile.activityLevel}\n`;
        if (profile.wakeTimeHour !== undefined) userContext += `- Wake Time: ${String(profile.wakeTimeHour).padStart(2, '0')}:${String(profile.wakeTimeMinute || 0).padStart(2, '0')}\n`;
        if (profile.sleepTimeHour !== undefined) userContext += `- Sleep Time: ${String(profile.sleepTimeHour).padStart(2, '0')}:${String(profile.sleepTimeMinute || 0).padStart(2, '0')}\n`;
        if (profile.waterTargetMl) userContext += `- Daily Water Target: ${profile.waterTargetMl} ml\n`;
        if (profile.dailyCalTarget) userContext += `- Daily Calorie Target: ${profile.dailyCalTarget} kcal\n`;

        userContext += '\n';
    }

    // Retrieve relevant KB knowledge
    const kbContext = retrieveHealthKnowledge(query, 3, 1200);

    return userContext + kbContext;
}
