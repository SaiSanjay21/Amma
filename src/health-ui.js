/**
 * RemindMe AI — Health Dashboard UI
 * Renders health dashboard, quick-log sheets, onboarding wizard,
 * and morning sleep popup.
 *
 * Match the existing rendering pattern from main.js → renderReminders()
 * (Pattern 6 in CODE_PATTERNS.md):
 * - innerHTML with escapeHtml() for user text
 * - .empty-state, .card classes
 * - showToast() for feedback
 * - async/await for DB, isCapacitorNative() branching
 */

import { registerPlugin } from '@capacitor/core';
import {
  getHealthProfile, setHealthProfile,
  addHealthMetric, sumTodayMetric, getTodayMetrics,
  getHealthMetricsByType, getSetting, setSetting,
} from './db.js';
import {
  calcWaterTarget, calcBMR, calcDailyCalories,
  vitaminDLevel, sleepQuality, estimateFoodCalories,
  calcMealTimes,
} from './health.js';

// ==========================================
// Native Health Plugin Bridge
// ==========================================
const HealthPlugin = registerPlugin('HealthPlugin');

function isCapacitorNative() {
  return window.Capacitor && Capacitor.isNativePlatform();
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function showToast(message, type = 'info') {
  // Reuse main.js showToast if available on window, otherwise inline
  if (window.__showToast) {
    window.__showToast(message, type);
    return;
  }
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.classList.add('show'), 10);
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// ==========================================
// Dashboard Rendering
// ==========================================

export async function renderHealthDashboard() {
  const container = document.getElementById('health-dashboard-content');
  if (!container) return;

  const onboardingDone = await getHealthProfile('onboardingDone', false);
  if (!onboardingDone) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">❤️</div>
        <h3>Set up your health profile</h3>
        <p>Complete a quick onboarding to get personalized health targets.</p>
        <button class="btn btn-primary" id="btn-start-onboarding">Get Started</button>
      </div>
    `;
    const btn = document.getElementById('btn-start-onboarding');
    if (btn) btn.addEventListener('click', () => showHealthOnboarding());
    return;
  }

  // Read today's data
  const waterToday = await sumTodayMetric('WATER_ML');
  const caloriesToday = await sumTodayMetric('CALORIES_IN');
  const sleepToday = await sumTodayMetric('SLEEP_HOURS');
  const sleepQualToday = await sumTodayMetric('SLEEP_QUALITY');
  const sunlightToday = await sumTodayMetric('SUNLIGHT_MINUTES');

  // Read targets
  const waterTarget = await getHealthProfile('waterTargetMl', 2000);
  const calTarget = await getHealthProfile('dailyCalTarget', 2000);

  // Calculate percentages (cap at 100%)
  const waterPct = Math.min(100, Math.round((waterToday / waterTarget) * 100));
  const calPct = Math.min(100, Math.round((caloriesToday / calTarget) * 100));

  // Sleep & sunlight status
  const sleepStatus = sleepToday > 0 ? sleepQuality(sleepToday, sleepQualToday) : '—';
  const sunStatus = vitaminDLevel(sunlightToday);
  const sleepBadgeClass = sleepStatus === 'GOOD' ? 'badge-good' : sleepStatus === 'FAIR' ? 'badge-fair' : sleepStatus === 'POOR' ? 'badge-poor' : '';
  const sunBadgeClass = sunStatus.level === 'HIGH' ? 'badge-high' : sunStatus.level === 'ADEQUATE' ? 'badge-adequate' : 'badge-low';

  // 7-day chart data
  const waterChart = await buildWeekChart('WATER_ML');
  const calChart = await buildWeekChart('CALORIES_IN');
  const sleepChart = await buildWeekChart('SLEEP_HOURS');

  container.innerHTML = `
    <!-- Today's Summary -->
    <div class="card" style="margin-bottom: 16px;">
      <h3 style="margin-bottom: 12px;">📊 Today's Summary</h3>

      <div class="health-summary-row">
        <span>💧 Water</span>
        <span>${waterToday} / ${waterTarget} ml</span>
      </div>
      <div class="progress-track">
        <div class="progress-bar water" style="width: ${waterPct}%"></div>
      </div>

      <div class="health-summary-row">
        <span>🍽️ Calories</span>
        <span>${caloriesToday} / ${calTarget} kcal</span>
      </div>
      <div class="progress-track">
        <div class="progress-bar calories" style="width: ${calPct}%"></div>
      </div>

      <div class="health-summary-row">
        <span>😴 Sleep</span>
        <span>${sleepToday > 0 ? sleepToday + 'h' : 'Not logged'}
          ${sleepQualToday > 0 ? ' | Quality: ' + sleepQualToday + '/10' : ''}
          ${sleepStatus !== '—' ? ' <span class="badge ' + sleepBadgeClass + '">' + sleepStatus + '</span>' : ''}</span>
      </div>

      <div class="health-summary-row">
        <span>☀️ Sunlight</span>
        <span>${sunlightToday} min
          <span class="badge ${sunBadgeClass}">${sunStatus.level}</span></span>
      </div>
    </div>

    <!-- Quick Log Buttons -->
    <div class="quick-log-row">
      <button class="btn btn-secondary" data-log="water-250">+250ml 💧</button>
      <button class="btn btn-secondary" data-log="water-500">+500ml 💧</button>
      <button class="btn btn-secondary" data-log="meal">Log Meal 🍽️</button>
      <button class="btn btn-secondary" data-log="sleep">Log Sleep 😴</button>
      <button class="btn btn-secondary" data-log="sunlight">Log Sunlight ☀️</button>
    </div>

    <!-- 7-Day Charts -->
    <div class="card" style="margin-top: 16px;">
      <h3>💧 Water — Last 7 Days</h3>
      ${renderBarChart(waterChart, 'water')}
    </div>
    <div class="card" style="margin-top: 12px;">
      <h3>🍽️ Calories — Last 7 Days</h3>
      ${renderBarChart(calChart, 'calories')}
    </div>
    <div class="card" style="margin-top: 12px; margin-bottom: 80px;">
      <h3>😴 Sleep — Last 7 Days</h3>
      ${renderBarChart(sleepChart, 'sleep')}
    </div>
  `;

  // Attach quick-log handlers
  container.querySelectorAll('[data-log]').forEach(btn => {
    btn.addEventListener('click', () => {
      const action = btn.getAttribute('data-log');
      if (action === 'water-250') logQuickWater(250);
      else if (action === 'water-500') logQuickWater(500);
      else if (action === 'meal') showQuickLogSheet('CALORIES_IN');
      else if (action === 'sleep') showQuickLogSheet('SLEEP_HOURS');
      else if (action === 'sunlight') showQuickLogSheet('SUNLIGHT_MINUTES');
    });
  });
}

async function logQuickWater(ml) {
  await addHealthMetric('WATER_ML', ml, '');
  showToast(`Logged ${ml}ml of water 💧`, 'success');
  renderHealthDashboard();
}

// ==========================================
// 7-Day Bar Chart Helpers
// ==========================================

async function buildWeekChart(metricType) {
  const days = [];
  const labels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const start = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const end = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999).getTime();
    const metrics = await getHealthMetricsByType(metricType, start, end);
    const total = metrics.reduce((s, m) => s + m.value, 0);
    days.push({ label: labels[d.getDay()], value: total });
  }
  return days;
}

function renderBarChart(data, colorClass) {
  const maxVal = Math.max(...data.map(d => d.value), 1);
  const bars = data.map(d => {
    const heightPct = Math.max(4, Math.round((d.value / maxVal) * 100));
    return `
      <div style="flex:1; display:flex; flex-direction:column; align-items:center;">
        <div class="health-bar ${colorClass}" style="height: ${heightPct}%; width: 100%;"></div>
        <div class="health-bar-label">${d.label}</div>
        <div class="health-bar-label">${d.value > 0 ? d.value : ''}</div>
      </div>
    `;
  }).join('');
  return `<div class="health-bar-chart">${bars}</div>`;
}

// ==========================================
// Quick Log Bottom Sheets
// ==========================================

export function showQuickLogSheet(type) {
  // Remove existing sheet
  const existing = document.querySelector('.bottom-sheet-overlay');
  if (existing) existing.remove();

  let title, body;

  if (type === 'WATER_ML') {
    title = 'Log Water Intake 💧';
    body = `
      <div class="form-group">
        <label>Amount (ml)</label>
        <input type="number" id="log-water-input" placeholder="Amount in ml" value="250" />
      </div>
      <div class="quick-log-row" style="margin-bottom: 12px;">
        <button class="btn btn-ghost" data-preset="200">200ml</button>
        <button class="btn btn-ghost" data-preset="250">250ml</button>
        <button class="btn btn-ghost" data-preset="500">500ml</button>
      </div>
      <button class="btn btn-primary" id="log-submit" style="width:100%">Log Water</button>
    `;
  } else if (type === 'CALORIES_IN') {
    title = 'Log Meal 🍽️';
    body = `
      <div class="form-group">
        <label>Describe what you ate</label>
        <input type="text" id="log-meal-input" placeholder="e.g. burger and fries" />
      </div>
      <p style="font-size: 0.75rem; opacity: 0.6;">ⓘ Estimates are approximate. Not medical advice.</p>
      <button class="btn btn-primary" id="log-submit" style="width:100%">Log Meal</button>
    `;
  } else if (type === 'SLEEP_HOURS') {
    title = 'Log Sleep 😴';
    body = `
      <div class="form-group">
        <label>Hours slept</label>
        <input type="number" id="log-sleep-hours" placeholder="e.g. 7.5" step="0.5" min="0" max="24" />
      </div>
      <div class="form-group">
        <label>Sleep depth / quality (1–10): <span id="sleep-quality-val">7</span></label>
        <input type="range" id="log-sleep-quality" min="1" max="10" value="7" />
      </div>
      <button class="btn btn-primary" id="log-submit" style="width:100%">Log Sleep</button>
    `;
  } else if (type === 'SUNLIGHT_MINUTES') {
    title = 'Log Sunlight ☀️';
    body = `
      <div class="form-group">
        <label>Minutes in sunlight: <span id="sunlight-val">15</span></label>
        <input type="range" id="log-sunlight-input" min="0" max="120" value="15" />
      </div>
      <button class="btn btn-primary" id="log-submit" style="width:100%">Log Sunlight</button>
    `;
  }

  const overlay = document.createElement('div');
  overlay.className = 'bottom-sheet-overlay';
  overlay.innerHTML = `
    <div class="bottom-sheet">
      <h3 style="margin-bottom: 16px;">${title}</h3>
      ${body}
      <button class="btn btn-ghost" id="log-cancel" style="width:100%; margin-top: 8px;">Cancel</button>
    </div>
  `;
  document.body.appendChild(overlay);

  // Close on overlay click
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });
  overlay.querySelector('#log-cancel').addEventListener('click', () => overlay.remove());

  // Preset handlers for water
  overlay.querySelectorAll('[data-preset]').forEach(btn => {
    btn.addEventListener('click', () => {
      const input = overlay.querySelector('#log-water-input');
      if (input) input.value = btn.getAttribute('data-preset');
    });
  });

  // Sleep quality slider label
  const sleepSlider = overlay.querySelector('#log-sleep-quality');
  if (sleepSlider) {
    sleepSlider.addEventListener('input', () => {
      overlay.querySelector('#sleep-quality-val').textContent = sleepSlider.value;
    });
  }

  // Sunlight slider label
  const sunSlider = overlay.querySelector('#log-sunlight-input');
  if (sunSlider) {
    sunSlider.addEventListener('input', () => {
      overlay.querySelector('#sunlight-val').textContent = sunSlider.value;
    });
  }

  // Submit handler
  overlay.querySelector('#log-submit').addEventListener('click', async () => {
    if (type === 'WATER_ML') {
      const ml = parseInt(overlay.querySelector('#log-water-input').value) || 250;
      await addHealthMetric('WATER_ML', ml, '');
      showToast(`Logged ${ml}ml of water 💧`, 'success');
    } else if (type === 'CALORIES_IN') {
      const desc = overlay.querySelector('#log-meal-input').value.trim();
      if (!desc) { showToast('Please describe your meal', 'error'); return; }
      const est = estimateFoodCalories(desc);
      await addHealthMetric('CALORIES_IN', est.estimate, desc);
      showToast(`Logged ~${est.min}–${est.max} kcal for "${desc}" 🍽️`, 'success');
    } else if (type === 'SLEEP_HOURS') {
      const hours = parseFloat(overlay.querySelector('#log-sleep-hours').value) || 0;
      const quality = parseInt(overlay.querySelector('#log-sleep-quality').value) || 5;
      if (hours <= 0) { showToast('Please enter hours slept', 'error'); return; }
      await addHealthMetric('SLEEP_HOURS', hours, '');
      await addHealthMetric('SLEEP_QUALITY', quality, '');
      const sq = sleepQuality(hours, quality);
      showToast(`Sleep logged: ${hours}h, quality ${quality}/10 → ${sq} 😴`, 'success');
    } else if (type === 'SUNLIGHT_MINUTES') {
      const mins = parseInt(overlay.querySelector('#log-sunlight-input').value) || 0;
      await addHealthMetric('SUNLIGHT_MINUTES', mins, '');
      const vd = vitaminDLevel(mins);
      showToast(`${mins} min sunlight → ${vd.level}. ${vd.tip}`, 'success');
    }
    overlay.remove();
    renderHealthDashboard();
  });
}

// ==========================================
// Health Onboarding Wizard
// ==========================================

export function showHealthOnboarding() {
  let currentStep = 0;
  const profileData = {};
  const totalSteps = 10;

  const steps = [
    {
      icon: '👋',
      html: `
        <span class="onboard-step-icon">👋</span>
        <h2>Welcome!</h2>
        <p class="onboard-subtitle">I'm <span class="gradient-text">Amma</span>. Let me learn a bit about you so I can give personalised health reminders and insights.</p>
        <button class="btn btn-primary onboard-cta-btn" id="onboard-next">Get Started</button>
      `,
      save: () => { },
    },
    {
      icon: '🎂',
      html: `
        <span class="onboard-step-icon">🎂</span>
        <h3>How old are you?</h3>
        <p class="onboard-subtitle">This helps calculate your daily calorie and water needs.</p>
        <div class="onboard-input-wrap">
          <input type="number" id="onboard-age" min="1" max="120" placeholder="25" />
          <span class="onboard-input-unit">Years old</span>
        </div>
        <button class="btn btn-primary onboard-cta-btn" id="onboard-next">Next →</button>
      `,
      save: () => { profileData.age = parseInt(document.getElementById('onboard-age').value) || 25; },
    },
    {
      icon: '📏',
      html: `
        <span class="onboard-step-icon">📏</span>
        <h3>How tall are you?</h3>
        <p class="onboard-subtitle">We'll use this with your weight to calculate BMI and nutrition targets.</p>
        <div class="onboard-input-wrap">
          <input type="number" id="onboard-height" placeholder="170" />
          <span class="onboard-input-unit">Centimetres (cm)</span>
        </div>
        <button class="btn btn-primary onboard-cta-btn" id="onboard-next">Next →</button>
      `,
      save: () => { profileData.heightCm = parseInt(document.getElementById('onboard-height').value) || 170; },
    },
    {
      icon: '⚖️',
      html: `
        <span class="onboard-step-icon">⚖️</span>
        <h3>What's your weight?</h3>
        <p class="onboard-subtitle">Used for personalised water intake and calorie calculations.</p>
        <div class="onboard-input-wrap">
          <input type="number" id="onboard-weight" step="0.1" placeholder="70" />
          <span class="onboard-input-unit">Kilograms (kg)</span>
        </div>
        <button class="btn btn-primary onboard-cta-btn" id="onboard-next">Next →</button>
      `,
      save: () => { profileData.weightKg = parseFloat(document.getElementById('onboard-weight').value) || 70; },
    },
    {
      icon: '👤',
      html: `
        <span class="onboard-step-icon">👤</span>
        <h3>What's your gender?</h3>
        <p class="onboard-subtitle">Helps calculate BMR — metabolic rates differ between genders.</p>
        <div class="onboard-chips">
          <button class="chip-btn" data-gender="MALE">🙋‍♂️ Male</button>
          <button class="chip-btn" data-gender="FEMALE">🙋‍♀️ Female</button>
          <button class="chip-btn" data-gender="OTHER">🧑 Other / Prefer not to say</button>
        </div>
      `,
      save: () => { },
      isChip: true,
      chipSelector: '[data-gender]',
      chipKey: 'gender',
    },
    {
      icon: '🏃',
      html: `
        <span class="onboard-step-icon">🏃</span>
        <h3>How active are you?</h3>
        <p class="onboard-subtitle">Your activity level determines your daily calorie needs.</p>
        <div class="onboard-chips">
          <button class="chip-btn" data-activity="SEDENTARY">🪑 Mostly sitting<br><span class="chip-desc">Desk job, minimal movement</span></button>
          <button class="chip-btn" data-activity="LIGHT">🚶 Lightly active<br><span class="chip-desc">Walking, light chores 1-3 days/week</span></button>
          <button class="chip-btn" data-activity="MODERATE">🏋️ Moderately active<br><span class="chip-desc">Exercise or sports 3-5 days/week</span></button>
          <button class="chip-btn" data-activity="ACTIVE">💪 Very active<br><span class="chip-desc">Hard exercise 6-7 days/week</span></button>
        </div>
      `,
      save: () => { },
      isChip: true,
      chipSelector: '[data-activity]',
      chipKey: 'activityLevel',
    },
    {
      icon: '🌅',
      html: `
        <span class="onboard-step-icon">🌅</span>
        <h3>What time do you wake up?</h3>
        <p class="onboard-subtitle">We'll schedule your water and meal reminders around your routine.</p>
        <div class="onboard-input-wrap">
          <input type="time" id="onboard-wake" value="07:00" />
          <span class="onboard-input-unit">Usual wake-up time</span>
        </div>
        <button class="btn btn-primary onboard-cta-btn" id="onboard-next">Next →</button>
      `,
      save: () => {
        const t = document.getElementById('onboard-wake').value.split(':');
        profileData.wakeTimeHour = parseInt(t[0]) || 7;
        profileData.wakeTimeMinute = parseInt(t[1]) || 0;
      },
    },
    {
      icon: '🌙',
      html: `
        <span class="onboard-step-icon">🌙</span>
        <h3>What time do you sleep?</h3>
        <p class="onboard-subtitle">Reminders won't bother you during sleep hours.</p>
        <div class="onboard-input-wrap">
          <input type="time" id="onboard-sleep" value="23:00" />
          <span class="onboard-input-unit">Usual bedtime</span>
        </div>
        <button class="btn btn-primary onboard-cta-btn" id="onboard-next">Next →</button>
      `,
      save: () => {
        const t = document.getElementById('onboard-sleep').value.split(':');
        profileData.sleepTimeHour = parseInt(t[0]) || 23;
        profileData.sleepTimeMinute = parseInt(t[1]) || 0;
      },
    },
    {
      icon: '☀️',
      html: `
        <span class="onboard-step-icon">☀️</span>
        <h3>Daily sunlight exposure?</h3>
        <p class="onboard-subtitle">NIH recommends 10-30 min midday sun for vitamin D synthesis.</p>
        <div class="onboard-slider-wrap">
          <div class="onboard-slider-value" id="onboard-sun-val">30</div>
          <div class="onboard-slider-label">Minutes per day</div>
          <input type="range" id="onboard-sunlight" min="0" max="120" value="30" />
        </div>
        <button class="btn btn-primary onboard-cta-btn" id="onboard-next">Next →</button>
      `,
      save: () => { profileData.avgSunlightMins = parseInt(document.getElementById('onboard-sunlight').value) || 30; },
      afterRender: () => {
        const slider = document.getElementById('onboard-sunlight');
        if (slider) slider.addEventListener('input', () => {
          document.getElementById('onboard-sun-val').textContent = slider.value;
        });
      },
    },
    // Final: Summary
    {
      icon: '🎉',
      html: '', // Set dynamically
      save: () => { },
      isSummary: true,
    },
  ];

  // Create overlay
  const overlay = document.createElement('div');
  overlay.id = 'health-onboarding-overlay';
  overlay.className = 'onboarding-overlay';
  document.body.appendChild(overlay);

  function buildProgressDots() {
    let dots = '';
    for (let i = 0; i < totalSteps; i++) {
      const cls = i < currentStep ? 'done' : i === currentStep ? 'active' : '';
      dots += `<div class="onboard-dot ${cls}"></div>`;
    }
    return `<div class="onboard-progress">${dots}</div>`;
  }

  function renderStep() {
    const step = steps[currentStep];
    let html = step.html;

    // Build summary for last step
    if (step.isSummary) {
      const wt = calcWaterTarget(profileData.weightKg || 70, profileData.activityLevel || 'SEDENTARY');
      const bmr = calcBMR(profileData.weightKg || 70, profileData.heightCm || 170, profileData.age || 25, profileData.gender || 'MALE');
      const cal = calcDailyCalories(bmr, profileData.activityLevel || 'SEDENTARY');
      profileData.waterTargetMl = wt;
      profileData.dailyCalTarget = cal;

      const bmi = profileData.heightCm && profileData.weightKg
        ? (profileData.weightKg / Math.pow(profileData.heightCm / 100, 2)).toFixed(1)
        : '—';

      html = `
        <span class="onboard-step-icon">🎉</span>
        <h2>You're all set!</h2>
        <p class="onboard-subtitle">Here are your personalised daily targets based on your profile.</p>
        <div class="onboard-summary-card">
          <div class="onboard-summary-row">
            <span class="sum-icon">💧</span>
            <span class="sum-label">Water Target</span>
            <span class="sum-value">${wt} ml</span>
          </div>
          <div class="onboard-summary-row">
            <span class="sum-icon">🔥</span>
            <span class="sum-label">Daily Calories</span>
            <span class="sum-value">${cal} kcal</span>
          </div>
          <div class="onboard-summary-row">
            <span class="sum-icon">📊</span>
            <span class="sum-label">Your BMI</span>
            <span class="sum-value">${bmi}</span>
          </div>
          <div class="onboard-summary-row">
            <span class="sum-icon">⚡</span>
            <span class="sum-label">Activity Level</span>
            <span class="sum-value">${(profileData.activityLevel || 'SEDENTARY').charAt(0) + (profileData.activityLevel || 'SEDENTARY').slice(1).toLowerCase()}</span>
          </div>
        </div>
        <p style="font-size: 0.75rem; color: var(--text-secondary); margin-top: 4px;">Based on Mifflin-St Jeor equation & NIH guidelines. ⓘ Not medical advice.</p>
        <button class="btn btn-primary onboard-cta-btn" id="onboard-finish">Start Using Amma ❤️</button>
      `;
    }

    overlay.innerHTML = `
      ${buildProgressDots()}
      <div class="onboarding-card" key="${currentStep}">
        ${html}
        ${currentStep > 0 && !step.isSummary ? '<a href="#" class="onboard-skip-link" id="onboard-skip">Skip for now</a>' : ''}
      </div>
    `;

    // Next button
    const nextBtn = overlay.querySelector('#onboard-next');
    if (nextBtn) {
      nextBtn.addEventListener('click', () => {
        step.save();
        currentStep++;
        renderStep();
      });
    }

    // Chip selection (gender, activity)
    if (step.isChip) {
      overlay.querySelectorAll(step.chipSelector).forEach(btn => {
        btn.addEventListener('click', () => {
          profileData[step.chipKey] = btn.getAttribute(`data-${step.chipKey === 'gender' ? 'gender' : 'activity'}`);
          currentStep++;
          renderStep();
        });
      });
    }

    // Finish button
    const finishBtn = overlay.querySelector('#onboard-finish');
    if (finishBtn) {
      finishBtn.addEventListener('click', async () => {
        // Save all profile data
        for (const [key, value] of Object.entries(profileData)) {
          await setHealthProfile(key, value);
        }
        await setHealthProfile('onboardingDone', true);

        // Schedule health reminders
        await scheduleHealthReminders();

        overlay.remove();
        renderHealthDashboard();
      });
    }

    // Skip link
    const skipLink = overlay.querySelector('#onboard-skip');
    if (skipLink) {
      skipLink.addEventListener('click', async (e) => {
        e.preventDefault();
        await setHealthProfile('onboardingDone', true);
        overlay.remove();
        renderHealthDashboard();
      });
    }

    // After-render hooks
    if (step.afterRender) step.afterRender();

    // Auto-focus input fields
    const firstInput = overlay.querySelector('input[type="number"], input[type="time"]');
    if (firstInput) setTimeout(() => firstInput.focus(), 350);
  }

  renderStep();
}

// ==========================================
// Morning Sleep Popup
// ==========================================

export async function checkMorningSleepPopup() {
  const now = new Date();
  const hour = now.getHours();

  // Only show between 5 and 10 AM
  if (hour < 5 || hour > 10) return;

  const today = `${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, '0')}-${now.getDate().toString().padStart(2, '0')}`;
  const lastPopup = await getSetting('lastSleepPopupDate', '');
  if (lastPopup === today) return;

  const sleepLogged = await sumTodayMetric('SLEEP_HOURS');
  if (sleepLogged > 0) return;

  // Check onboarding is done
  const onboardingDone = await getHealthProfile('onboardingDone', false);
  if (!onboardingDone) return;

  // Show popup
  const popup = document.createElement('div');
  popup.className = 'popup-card';
  popup.id = 'morning-sleep-popup';
  popup.innerHTML = `
    <h3 style="margin-bottom: 12px;">Good morning! 🌅</h3>
    <p>How did you sleep last night?</p>
    <div class="form-group">
      <label>Hours slept</label>
      <input type="number" id="popup-sleep-hours" placeholder="e.g. 7.5" step="0.5" min="0" max="24" />
    </div>
    <div class="form-group">
      <label>Sleep depth (1=light, 10=deep): <span id="popup-qual-val">7</span></label>
      <input type="range" id="popup-sleep-quality" min="1" max="10" value="7" />
    </div>
    <div style="display: flex; gap: 8px; margin-top: 12px;">
      <button class="btn btn-ghost" id="popup-skip" style="flex: 1;">Skip</button>
      <button class="btn btn-primary" id="popup-submit" style="flex: 1;">Submit</button>
    </div>
  `;
  document.body.appendChild(popup);

  // Slider label
  popup.querySelector('#popup-sleep-quality').addEventListener('input', (e) => {
    popup.querySelector('#popup-qual-val').textContent = e.target.value;
  });

  // Skip
  popup.querySelector('#popup-skip').addEventListener('click', async () => {
    await setSetting('lastSleepPopupDate', today);
    popup.remove();
  });

  // Submit
  popup.querySelector('#popup-submit').addEventListener('click', async () => {
    const hours = parseFloat(popup.querySelector('#popup-sleep-hours').value) || 0;
    const quality = parseInt(popup.querySelector('#popup-sleep-quality').value) || 5;
    if (hours > 0) {
      await addHealthMetric('SLEEP_HOURS', hours, '');
      await addHealthMetric('SLEEP_QUALITY', quality, '');
      const sq = sleepQuality(hours, quality);
      showToast(`Sleep logged: ${sq} (${hours}h, quality ${quality}/10)`, 'success');
    }
    await setSetting('lastSleepPopupDate', today);
    popup.remove();
    renderHealthDashboard();
  });
}

// ==========================================
// Health Reminders Scheduling
// ==========================================

export async function scheduleHealthReminders() {
  if (!isCapacitorNative()) return;

  try {
    await HealthPlugin.createNotificationChannel();

    const wakeHour = await getHealthProfile('wakeTimeHour', 7);
    const wakeMin = await getHealthProfile('wakeTimeMinute', 0);
    const sleepHour = await getHealthProfile('sleepTimeHour', 23);
    const sleepMin = await getHealthProfile('sleepTimeMinute', 0);
    const target = await getHealthProfile('waterTargetMl', 2000);

    const meals = calcMealTimes(wakeHour, wakeMin);

    await HealthPlugin.scheduleWaterReminders({
      intervalMinutes: 90,
      wakeHour,
      wakeMinute: wakeMin,
      sleepHour,
      sleepMinute: sleepMin,
      targetMl: target,
    });

    await HealthPlugin.scheduleMealReminders({
      breakfastHour: meals.breakfast.hour,
      breakfastMinute: meals.breakfast.minute,
      lunchHour: meals.lunch.hour,
      lunchMinute: meals.lunch.minute,
      dinnerHour: meals.dinner.hour,
      dinnerMinute: meals.dinner.minute,
    });

    console.log('❤️ Health reminders scheduled');
  } catch (e) {
    console.warn('Health reminders not available:', e.message);
  }
}
