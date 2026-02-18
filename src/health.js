/**
 * RemindMe AI — Health Calculation Engine
 * Pure calculation utilities for health tracking.
 * No DOM, no DB, no side effects — pure functions only.
 *
 * SOURCES / EVIDENCE BASE:
 * ─────────────────────────
 * Water:  National Academies of Medicine (IOM) — AI for total fluid:
 *         Men ~3.7 L/day, Women ~2.7 L/day (from beverages + food).
 *         Rule of thumb: 30-35 ml per kg body weight.
 *         Add ~350-500 ml for every 30 min moderate exercise.
 *         [Source: NIH PMC, Mayo Clinic, healthline.com]
 *
 * BMR:   Mifflin-St Jeor Equation (1990) — most accurate for modern
 *        populations (82% within 10% of measured REE vs 70% Harris-Benedict).
 *        Male:   (10 × weightKg) + (6.25 × heightCm) − (5 × age) + 5
 *        Female: (10 × weightKg) + (6.25 × heightCm) − (5 × age) − 161
 *        [Source: ADA, caloriedeficitcalc.fit, NIH comparative study]
 *
 * TDEE Multipliers (Harris-Benedict Activity Factors):
 *        Sedentary (little/no exercise):  BMR × 1.2
 *        Light (1-3 days/week):           BMR × 1.375
 *        Moderate (3-5 days/week):        BMR × 1.55
 *        Active (6-7 days/week):          BMR × 1.725
 *        Very Active (2×/day):            BMR × 1.9
 *
 * Vitamin D & Sunlight:
 *        10-30 min midday sun (10AM-3PM) adequate for lighter skin.
 *        Darker skin needs 15-30+ min same period.
 *        Factors: latitude, skin type (Fitzpatrick I-VI), season, altitude.
 *        Serum 25(OH)D ≥ 50 nmol/L (20 ng/mL) is sufficient per NIH.
 *        [Source: NIH ODS, Dermatology Research, genexdiagnostics.com]
 *
 * Sleep: CDC recommends ≥ 7 hours for adults 18-60.
 *        NIH suggests 7-9 hours optimal range.
 *        ~25% should be deep sleep (N3 stage) ≈ 1.5-2h per night.
 *        Sleep regularity may matter more than duration (Lancet 2023).
 *        [Source: CDC.gov, NIH NHLBI, National Sleep Foundation]
 *
 * Calorie Estimation:
 *        USDA FoodData Central averages used for common food categories.
 *        Ranges reflect portion size variability.
 */

// ====================================================
// Water Intake Target
// ====================================================

/**
 * Calculate recommended daily water intake.
 * Base: 30-35 ml per kg body weight (IOM guideline).
 * Adjustments: +500ml for ACTIVE, +250ml for MODERATE.
 *
 * @param {number} weightKg - Body weight in kg
 * @param {string} activityLevel - SEDENTARY | LIGHT | MODERATE | ACTIVE
 * @returns {number} Target in ml
 */
export function calcWaterTarget(weightKg, activityLevel) {
    // IOM baseline: ~33 ml/kg (midpoint of 30-35 range)
    const base = Math.round(weightKg * 33);
    const activityBonus = {
        SEDENTARY: 0,
        LIGHT: 150,      // ~1 glass extra
        MODERATE: 350,    // ~1.5 glasses extra
        ACTIVE: 500,      // ~2 glasses extra (ACSM: 350-500ml per 30min exercise)
    };
    return base + (activityBonus[activityLevel] || 0);
}

// ====================================================
// Basal Metabolic Rate (Mifflin-St Jeor, 1990)
// ====================================================

/**
 * Calculate BMR using the Mifflin-St Jeor equation.
 * Considered the most accurate modern BMR formula by the ADA.
 *
 * @param {number} weightKg
 * @param {number} heightCm
 * @param {number} age
 * @param {string} gender - MALE | FEMALE | OTHER
 * @returns {number} BMR in kcal/day
 */
export function calcBMR(weightKg, heightCm, age, gender) {
    const base = (10 * weightKg) + (6.25 * heightCm) - (5 * age);
    // Males: +5, Females: -161, Other: average of both
    if (gender === 'FEMALE') return Math.round(base - 161);
    if (gender === 'OTHER') return Math.round(base - 78);  // midpoint
    return Math.round(base + 5);
}

// ====================================================
// Total Daily Energy Expenditure (TDEE)
// ====================================================

/**
 * Calculate daily calorie needs from BMR × activity factor.
 * Based on Harris-Benedict activity multipliers.
 */
export function calcDailyCalories(bmr, activityLevel) {
    const factors = {
        SEDENTARY: 1.2,
        LIGHT: 1.375,
        MODERATE: 1.55,
        ACTIVE: 1.725,
    };
    return Math.round(bmr * (factors[activityLevel] || 1.2));
}

// ====================================================
// Vitamin D / Sunlight Assessment
// ====================================================

/**
 * Assess vitamin D synthesis potential from sunlight duration.
 * Based on NIH ODS and dermatology research.
 *
 * Thresholds (for lighter skin, midday sun):
 *   - < 10 min  → LOW (insufficient UVB for meaningful synthesis)
 *   - 10-29 min → ADEQUATE (10-30 min recommended by NIH)
 *   - ≥ 30 min  → HIGH (good exposure; apply sunscreen after 30 min)
 *
 * @param {number} sunlightMinutes
 * @returns {{ level: string, tip: string, details: string }}
 */
export function vitaminDLevel(sunlightMinutes) {
    if (sunlightMinutes < 10) return {
        level: 'LOW',
        tip: 'Try 10-30 min of midday sun on bare arms/face ☀️',
        details: 'NIH recommends 10-30 min midday sun for vitamin D synthesis. Darker skin may need longer.'
    };
    if (sunlightMinutes < 30) return {
        level: 'ADEQUATE',
        tip: 'Good sun exposure today! Apply sunscreen if staying longer.',
        details: 'You\'re in the NIH-recommended 10-30 min range for vitamin D.'
    };
    return {
        level: 'HIGH',
        tip: 'Excellent sunlight today! Remember sunscreen for extended exposure.',
        details: 'Great exposure. NIH notes risk of skin damage beyond 30 min without protection.'
    };
}

// ====================================================
// Sleep Quality Assessment
// ====================================================

/**
 * Assess sleep quality based on CDC/NIH guidelines.
 * CDC: Adults 18-60 need ≥ 7 hours. NIH: 7-9 hours optimal.
 * Rating 1-10 represents subjective depth/restfulness.
 *
 * Classification:
 *   POOR  → <6h OR self-rated quality <4/10
 *   FAIR  → 6-6.9h OR 7h+ but quality <7/10
 *   GOOD  → ≥7h AND quality ≥7/10 (meets CDC recommendation)
 *
 * @param {number} hours  - Hours slept
 * @param {number} rating - Self-reported quality 1-10
 * @returns {string} POOR | FAIR | GOOD
 */
export function sleepQuality(hours, rating) {
    if (hours < 6 || rating < 4) return 'POOR';
    if (hours >= 7 && rating >= 7) return 'GOOD';
    return 'FAIR';
}

// ====================================================
// Food Calorie Estimation
// ====================================================

/**
 * Rough calorie estimation from food description.
 * Based on USDA FoodData Central averages for common categories.
 * Returns a range (min-max) and a midpoint estimate.
 *
 * NOTE: This is a convenience feature, not a medical tool.
 * Accuracy depends on portion size, preparation method, etc.
 */
export function estimateFoodCalories(description) {
    const lower = description.toLowerCase();

    // Heavy meals (USDA: burger 354-700, pizza slice 285, biryani ~400-600)
    if (/burger|pizza|pasta|rice.*chicken|full.*plate|biryani|thali|steak|fried.*rice/.test(lower))
        return { min: 700, max: 1100, estimate: 900, source: 'USDA avg for heavy meal' };

    // Medium meals
    if (/sandwich|wrap|bowl|soup|salad.*chicken|noodles|dosa|paratha|omelette|eggs/.test(lower))
        return { min: 350, max: 600, estimate: 475, source: 'USDA avg for medium meal' };

    // Light meals / small plates
    if (/toast|cereal|oatmeal|yogurt|idli|upma|poha/.test(lower))
        return { min: 200, max: 400, estimate: 300, source: 'USDA avg for light meal' };

    // Beverages (non-water)
    if (/coffee|tea/.test(lower))
        return { min: 5, max: 80, estimate: 30, source: 'USDA; varies by milk/sugar' };
    if (/juice|soda|drink|smoothie|milkshake|lassi/.test(lower))
        return { min: 100, max: 250, estimate: 160, source: 'USDA avg for sweetened beverage' };
    if (/water/.test(lower))
        return { min: 0, max: 0, estimate: 0, source: 'water is 0 kcal' };

    // Snacks / fruits
    if (/fruit|snack|biscuit|cookie|banana|apple|candy|chips|nuts/.test(lower))
        return { min: 80, max: 250, estimate: 150, source: 'USDA avg for snack' };

    // Default: assume a medium-sized meal
    return { min: 400, max: 700, estimate: 550, source: 'Default estimate for unrecognised meal' };
}

// ====================================================
// Meal Timing Calculator
// ====================================================

/**
 * Calculate suggested meal times based on wake-up time.
 * Research: first meal ~1h after waking, lunch ~5h, dinner ~11h.
 * Aligns with circadian rhythm research (Satchin Panda, NIH).
 */
export function calcMealTimes(wakeHour, wakeMinute) {
    const wake = wakeHour * 60 + wakeMinute;
    const toTime = (mins) => ({
        hour: Math.floor(mins / 60) % 24,
        minute: mins % 60,
    });
    return {
        breakfast: toTime(wake + 60),   // 1h after waking
        lunch: toTime(wake + 300),      // 5h after waking
        dinner: toTime(wake + 660),     // 11h after waking
    };
}

// ====================================================
// Health Knowledge Base (for AI context injection)
// ====================================================

/**
 * Returns a compact health knowledge string to inject into the AI prompt.
 * This gives the on-device Gemma 2B model research-backed context
 * so it can provide informed (but not medical) advice.
 */
export function getHealthKnowledgeContext() {
    return `
HEALTH KNOWLEDGE (sourced from NIH, CDC, WHO — for reference only, NOT medical advice):

WATER:
- IOM recommends ~3.7L/day for men, ~2.7L/day for women (from all sources).
- Rule of thumb: 30-35ml per kg body weight.
- Add 350-500ml per 30 min of moderate exercise (ACSM guideline).
- Signs of mild dehydration: fatigue, headache, dark urine, dry mouth.
- Overhydration (>6L/day) can cause hyponatremia — rare but possible.

CALORIES:
- Mifflin-St Jeor equation is the gold standard for estimating BMR.
- TDEE = BMR × activity factor (1.2 sedentary to 1.725 very active).
- 1 kg of body fat ≈ 7,700 kcal. A 500 kcal/day deficit → ~0.5kg/week loss.
- Minimum safe intake: ~1200 kcal/day women, ~1500 kcal/day men.

SLEEP:
- CDC: adults need ≥7 hours. NIH: 7-9 hours optimal.
- ~25% should be deep sleep (N3 stage) = 1.5-2h per night.
- Sleep regularity may predict mortality better than duration (Lancet 2023).
- Blue light from screens suppresses melatonin — avoid 30min before bed.
- Signs of poor sleep: >30 min to fall asleep, frequent waking, daytime fatigue.

SUNLIGHT / VITAMIN D:
- NIH: 10-30 min midday sun (10AM-3PM) for vitamin D synthesis.
- Darker skin (Fitzpatrick IV-VI) needs 2-3× longer for same vitamin D.
- At latitudes >40°, vitamin D synthesis is minimal Nov-Feb ("vitamin D winter").
- Apply sunscreen after the initial 10-30 min to prevent skin damage.
- Serum 25(OH)D ≥ 50 nmol/L (20 ng/mL) is sufficient (NIH ODS).

GENERAL:
- Regular physical activity: WHO recommends 150 min/week moderate aerobic.
- Sitting >8h/day without activity increases mortality risk (Lancet 2016).
- Hydration and sleep quality are bidirectionally linked.
`.trim();
}
