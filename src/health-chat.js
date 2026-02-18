/**
 * RemindMe AI — Health Chat Tool Call Handler
 * Parses and executes health tool calls from AI responses.
 * Match the async/await and showToast patterns from main.js.
 */

import {
    addHealthMetric, sumTodayMetric,
    getHealthProfile,
} from './db.js';
import { estimateFoodCalories, sleepQuality, vitaminDLevel } from './health.js';
import { renderHealthDashboard } from './health-ui.js';

export async function handleHealthToolCall(aiResponse) {
    // Extract JSON tool call from AI response
    const match = aiResponse.match(/\{"tool"\s*:\s*"([^"]+)"\s*,\s*"params"\s*:\s*\{([^}]*)\}\}/);
    if (!match) return null;

    let parsed;
    try {
        parsed = JSON.parse(match[0]);
    } catch {
        return null;
    }

    const { tool, params } = parsed;

    switch (tool) {
        case 'LOG_WATER': {
            const ml = params.ml || 250;
            await addHealthMetric('WATER_ML', ml, '');
            renderHealthDashboard();
            return `💧 Logged ${ml}ml of water.`;
        }

        case 'LOG_MEAL': {
            const desc = params.description || 'meal';
            const kcal = params.kcal || estimateFoodCalories(desc).estimate;
            await addHealthMetric('CALORIES_IN', kcal, desc);
            renderHealthDashboard();
            return `🍽️ Logged ~${kcal} kcal for "${desc}". ⓘ Not medical advice.`;
        }

        case 'LOG_SLEEP': {
            const hours = params.hours || 0;
            const quality = params.quality || 5;
            if (hours > 0) {
                await addHealthMetric('SLEEP_HOURS', hours, '');
                await addHealthMetric('SLEEP_QUALITY', quality, '');
                const sq = sleepQuality(hours, quality);
                renderHealthDashboard();
                return `😴 Sleep logged: ${hours}h, quality ${quality}/10 → ${sq}`;
            }
            return null;
        }

        case 'LOG_SUNLIGHT': {
            const mins = params.minutes || 0;
            await addHealthMetric('SUNLIGHT_MINUTES', mins, '');
            const vd = vitaminDLevel(mins);
            renderHealthDashboard();
            return `☀️ ${mins} min sunlight → ${vd.level}. ${vd.tip}`;
        }

        case 'QUERY_HEALTH': {
            const metric = params.metric || 'WATER_ML';
            const total = await sumTodayMetric(metric);
            const labels = {
                'WATER_ML': 'Water (ml)',
                'CALORIES_IN': 'Calories',
                'SLEEP_HOURS': 'Sleep (hours)',
                'SLEEP_QUALITY': 'Sleep Quality',
                'SUNLIGHT_MINUTES': 'Sunlight (min)',
            };
            return `Today's ${labels[metric] || metric}: ${total}`;
        }

        case 'HEALTH_SUMMARY': {
            const water = await sumTodayMetric('WATER_ML');
            const cals = await sumTodayMetric('CALORIES_IN');
            const sleep = await sumTodayMetric('SLEEP_HOURS');
            const sun = await sumTodayMetric('SUNLIGHT_MINUTES');
            const wTarget = await getHealthProfile('waterTargetMl', 2000);
            const cTarget = await getHealthProfile('dailyCalTarget', 2000);
            return `Today: 💧 ${water}/${wTarget}ml  🔥 ${cals}/${cTarget}kcal  😴 ${sleep}h  ☀️ ${sun}min`;
        }

        default:
            return null;
    }
}
