/**
 * RemindMe AI — Health Calculation Engine
 * Pure calculation utilities for health tracking.
 * No DOM, no DB, no side effects — pure functions only.
 */

export function calcWaterTarget(weightKg, activityLevel) {
    const base = Math.round(weightKg * 35);
    return activityLevel === 'ACTIVE' ? base + 500 : base;
}

export function calcBMR(weightKg, heightCm, age, gender) {
    const base = (10 * weightKg) + (6.25 * heightCm) - (5 * age);
    return gender === 'FEMALE' ? base - 161 : base + 5;
}

export function calcDailyCalories(bmr, activityLevel) {
    const factors = {
        SEDENTARY: 1.2,
        LIGHT: 1.375,
        MODERATE: 1.55,
        ACTIVE: 1.725,
    };
    return Math.round(bmr * (factors[activityLevel] || 1.2));
}

export function vitaminDLevel(sunlightMinutes) {
    if (sunlightMinutes < 15) return {
        level: 'LOW',
        tip: 'Try a short walk at lunch for some sunlight ☀️'
    };
    if (sunlightMinutes < 30) return {
        level: 'ADEQUATE',
        tip: 'Good sun exposure today!'
    };
    return {
        level: 'HIGH',
        tip: 'Excellent sunlight today! ☀️'
    };
}

export function sleepQuality(hours, rating) {
    if (hours < 6 || rating < 4) return 'POOR';
    if (hours >= 7 && rating >= 7) return 'GOOD';
    return 'FAIR';
}

export function estimateFoodCalories(description) {
    const lower = description.toLowerCase();
    if (/burger|pizza|pasta|rice.*chicken|full.*plate|biryani|thali/.test(lower))
        return { min: 800, max: 1000, estimate: 900 };
    if (/sandwich|wrap|bowl|soup|salad.*chicken|noodles|dosa/.test(lower))
        return { min: 400, max: 600, estimate: 500 };
    if (/coffee|tea|water/.test(lower))
        return { min: 5, max: 50, estimate: 20 };
    if (/juice|soda|drink|smoothie|milkshake/.test(lower))
        return { min: 100, max: 200, estimate: 150 };
    if (/fruit|snack|biscuit|cookie|banana|apple|candy/.test(lower))
        return { min: 100, max: 200, estimate: 150 };
    // Default medium meal
    return { min: 400, max: 700, estimate: 550 };
}

export function calcMealTimes(wakeHour, wakeMinute) {
    const wake = wakeHour * 60 + wakeMinute;
    const toTime = (mins) => ({
        hour: Math.floor(mins / 60) % 24,
        minute: mins % 60,
    });
    return {
        breakfast: toTime(wake + 60),
        lunch: toTime(wake + 300),
        dinner: toTime(wake + 660),
    };
}
