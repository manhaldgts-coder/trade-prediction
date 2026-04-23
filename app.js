// NexusTrade Breakout Radar Logic

// Elements
const wsStatus = document.getElementById('ws-status');
const btcPriceEl = document.getElementById('btc-price');
const scannedCountEl = document.getElementById('scanned-count');
const scalpSignalsContainer = document.getElementById('scalp-signals-container');
const swingSignalsContainer = document.getElementById('swing-signals-container');
const scalpEmptyState = document.getElementById('scalp-empty-state');
const swingEmptyState = document.getElementById('swing-empty-state');
const moversContainer = document.getElementById('movers-container');
const clearSignalsBtn = document.getElementById('clear-signals');

// Modal Elements
const chartModal = document.getElementById('chart-modal');
const closeModalBtn = document.getElementById('close-modal');
const modalTitle = document.getElementById('modal-title');
const intervalBtns = document.querySelectorAll('.interval-btn');
let tvWidget = null;
let currentChartSymbol = 'BTCUSDT';
let currentChartInterval = '1';

// Settings Elements
const sensitivitySlider = document.getElementById('sensitivity');
const sensitivityVal = document.getElementById('sensitivity-val');
const volumeFilter = document.getElementById('volume-filter');
const volumeVal = document.getElementById('volume-val');
const audioToggle = document.getElementById('audio-toggle');
const desktopToggle = document.getElementById('desktop-toggle');
const alertSound = document.getElementById('alert-sound');

// State
let pairsData = {};
let priceHistory = {}; // { 'BTCUSDT': [{t: timestamp, p: price}, ...] }
let lastNotifiedScalp = {}; // { 'BTCUSDT': timestamp }
let lastNotifiedSwing = {}; // { 'BTCUSDT': timestamp }
let activeTrades = {}; // Live tracking for active trade plans
let btcPrice = 0;
const HISTORY_WINDOW_MS = 60000; // 60 seconds
const COOLDOWN_MS = 5 * 60000; // 5 minutes cooldown per pair

// AI Dynamic Memory (Learning Engine)
let aiMemory = {
    patterns: {
        "Cup & Handle Breakout": { wins: 0, losses: 0, penalty: 0 },
        "Ascending Triangle": { wins: 0, losses: 0, penalty: 0 },
        "Double Bottom (Micro)": { wins: 0, losses: 0, penalty: 0 },
        "Bull Flag Breakout": { wins: 0, losses: 0, penalty: 0 },
        "Momentum Surge": { wins: 0, losses: 0, penalty: 0 },
        "Volume Accumulation": { wins: 0, losses: 0, penalty: 0 }
    }
};

const updateAILearning = (pattern, isWin) => {
    if (!aiMemory.patterns[pattern]) {
        aiMemory.patterns[pattern] = { wins: 0, losses: 0, penalty: 0 };
    }
    
    if (isWin) {
        aiMemory.patterns[pattern].wins++;
        // Recover confidence (reduce penalty)
        aiMemory.patterns[pattern].penalty = Math.max(0, aiMemory.patterns[pattern].penalty - 3); 
    } else {
        aiMemory.patterns[pattern].losses++;
        // Increase penalty for this pattern heavily to learn from mistake
        aiMemory.patterns[pattern].penalty += 10; 
    }
};

// Config
let config = {
    minVolume: parseInt(volumeFilter.value), // USDT
    sensitivityLevel: parseInt(sensitivitySlider.value),
    tradingMode: 'scalp'
};

// UI switch logic
window.setTradingMode = (mode) => {
    config.tradingMode = mode;
    const slider = document.getElementById('mode-slider');
    const scalpBtn = document.getElementById('mode-scalp');
    const swingBtn = document.getElementById('mode-swing');
    
    if (mode === 'scalp') {
        slider.style.transform = 'translateX(0)';
        scalpBtn.classList.replace('text-gray-500', 'text-black');
        swingBtn.classList.replace('text-black', 'text-gray-500');
        document.getElementById('dot-scalp').classList.add('hidden');
        scalpSignalsContainer.classList.remove('hidden');
        swingSignalsContainer.classList.add('hidden');
    } else {
        slider.style.transform = 'translateX(100%)';
        swingBtn.classList.replace('text-gray-500', 'text-black');
        scalpBtn.classList.replace('text-black', 'text-gray-500');
        document.getElementById('dot-swing').classList.add('hidden');
        swingSignalsContainer.classList.remove('hidden');
        scalpSignalsContainer.classList.add('hidden');
    }
};

// Sensitivity Map (Required % jump in 60 seconds)
// 1 = Low (Requires big 2.0% jump), 2 = Medium (1.0%), 3 = High (0.5%)
const getMomentumThreshold = () => {
    switch(config.sensitivityLevel) {
        case 1: return 3.0; // Very strict
        case 2: return 2.0; // Medium strict
        case 3: return 1.0; // High sensitivity (still requires 1% jump in 60s)
        default: return 1.0;
    }
};

const getSensitivityLabel = (level) => {
    switch(level) {
        case 1: return 'Low';
        case 2: return 'Medium';
        case 3: return 'High';
        default: return 'High';
    }
};

// Event Listeners for Settings
const sensitivityThumb = document.getElementById('sensitivity-thumb');

sensitivitySlider.addEventListener('input', (e) => {
    const val = parseInt(e.target.value);
    config.sensitivityLevel = val;
    sensitivityVal.textContent = getSensitivityLabel(val);
    
    // Update custom thumb position
    if (val === 1) {
        sensitivityThumb.style.left = '0%';
        sensitivityThumb.style.transform = 'translateX(0)';
    } else if (val === 2) {
        sensitivityThumb.style.left = '50%';
        sensitivityThumb.style.transform = 'translateX(-50%)';
    } else {
        sensitivityThumb.style.left = '100%';
        sensitivityThumb.style.transform = 'translateX(-100%)';
    }
    
    // Update dots coloring (color dots up to the current value)
    document.getElementById('dot-1').classList.toggle('bg-black', val >= 1);
    document.getElementById('dot-1').classList.toggle('bg-gray-300', val < 1);
    
    document.getElementById('dot-2').classList.toggle('bg-black', val >= 2);
    document.getElementById('dot-2').classList.toggle('bg-gray-300', val < 2);
    
    document.getElementById('dot-3').classList.toggle('bg-black', val >= 3);
    document.getElementById('dot-3').classList.toggle('bg-gray-300', val < 3);
});

// Init custom slider positions
sensitivitySlider.dispatchEvent(new Event('input'));

volumeFilter.addEventListener('change', (e) => {
    config.minVolume = parseInt(e.target.value);
    const millions = config.minVolume / 1000000;
    volumeVal.textContent = `$${millions}M`;
});

clearSignalsBtn.addEventListener('click', () => {
    if (config.tradingMode === 'scalp') {
        scalpSignalsContainer.innerHTML = '';
        scalpSignalsContainer.appendChild(scalpEmptyState);
        scalpEmptyState.style.display = 'flex';
    } else {
        swingSignalsContainer.innerHTML = '';
        swingSignalsContainer.appendChild(swingEmptyState);
        swingEmptyState.style.display = 'flex';
    }
});

// Advanced Theme Toggle Animation Setup
const togglerTurbulence = document.querySelector('#toggler-distortion feTurbulence');
let togglerLensFrame = 0;
const togglerRad = Math.PI / 180;

function animateTogglerLens() {
    const bfx = 0.01;
    const bfy = 0.04;
    const freqX = bfx + Math.cos(togglerLensFrame * togglerRad * 0.7) * 0.0011;
    const freqY = bfy + Math.sin(togglerLensFrame * togglerRad * 0.5) * 0.0015;

    if (togglerTurbulence) {
        togglerTurbulence.setAttribute('baseFrequency', `${freqX} ${freqY}`);
    }

    togglerLensFrame = (togglerLensFrame + 0.3) % 360;
    requestAnimationFrame(animateTogglerLens);
}
animateTogglerLens();

function setupLiquidToggle(toggleInput) {
    const wrapper = toggleInput.closest('.toggle-switch');
    const sliderKnob = wrapper.querySelector('.slider-knob');
    const magnifyingContent = sliderKnob.querySelector('.magnifying-content');
    const togglerDistortionLens = sliderKnob.querySelector('.distortion-lens');
    let isAnimating = false;

    sliderKnob.addEventListener('animationend', (event) => {
        if (event.target === sliderKnob) {
            sliderKnob.classList.remove('animate-on', 'animate-off');
            magnifyingContent.classList.remove('animate-on', 'animate-off');
            togglerDistortionLens.classList.remove('animate-on', 'animate-off');
            isAnimating = false;
            wrapper.style.pointerEvents = 'auto';
        }
    });

    toggleInput.addEventListener('change', (e) => {
        if (isAnimating) {
            toggleInput.checked = !toggleInput.checked;
            return;
        }

        // Special handling for desktop notifications
        if (toggleInput.id === 'desktop-toggle' && toggleInput.checked) {
            if ("Notification" in window) {
                Notification.requestPermission().then(permission => {
                    if (permission !== "granted") {
                        toggleInput.checked = false;
                        return; // Prevent animation
                    } else {
                        triggerAnimation();
                    }
                });
                return; // Wait for permission
            } else {
                toggleInput.checked = false;
                return;
            }
        }

        triggerAnimation();

        function triggerAnimation() {
            isAnimating = true;
            wrapper.style.pointerEvents = 'none';

            if (toggleInput.checked) {
                sliderKnob.classList.add('animate-on');
                magnifyingContent.classList.add('animate-on');
                togglerDistortionLens.classList.add('animate-on');
            } else {
                sliderKnob.classList.add('animate-off');
                magnifyingContent.classList.add('animate-off');
                togglerDistortionLens.classList.add('animate-off');
            }
        }
    });
}

setupLiquidToggle(audioToggle);
setupLiquidToggle(desktopToggle);

// Modal Logic
const renderChart = () => {
    document.getElementById('tv_chart_container').innerHTML = '';
    
    // Delay initialization slightly to ensure modal is fully visible and has dimensions
    setTimeout(() => {
        tvWidget = new TradingView.widget({
            "width": "100%",
            "height": "100%",
            "symbol": currentChartSymbol,
            "interval": currentChartInterval,
            "timezone": "Etc/UTC",
            "theme": "light",
            "style": "1",
            "locale": "en",
            "enable_publishing": false,
            "hide_top_toolbar": true, // Hide default toolbar since we have custom intervals
            "hide_legend": false,
            "save_image": false,
            "container_id": "tv_chart_container",
            "studies": [
                "Volume@tv-basicstudies"
            ]
        });
    }, 50);
};

const openChart = (symbol) => {
    currentChartSymbol = symbol;
    modalTitle.textContent = symbol;
    chartModal.classList.remove('hidden');
    renderChart();
};

// Interval Selection Logic
intervalBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
        // Update active state
        intervalBtns.forEach(b => {
            b.classList.remove('bg-white', 'shadow-sm', 'text-black', 'active');
            b.classList.add('text-gray-500');
        });
        const target = e.target;
        target.classList.remove('text-gray-500');
        target.classList.add('bg-white', 'shadow-sm', 'text-black', 'active');
        
        currentChartInterval = target.getAttribute('data-interval');
        renderChart();
    });
});

closeModalBtn.addEventListener('click', () => {
    chartModal.classList.add('hidden');
    document.getElementById('tv_chart_container').innerHTML = '';
    tvWidget = null;
});

// Helper formatting functions
const formatCurrency = (val) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val);
const formatNumber = (val) => new Intl.NumberFormat('en-US', { maximumFractionDigits: 4 }).format(val);
const formatTime = (date) => date.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute:'2-digit', second:'2-digit' });

// Trigger Notification
const triggerAlert = (symbol, price, momentum, volume, chanceScore = 95, chanceCategory = 'High', volAnomalyRatio = 3.5, tradePlan = null, pattern = 'Bull Flag Breakout', mode = 'scalp') => {
    const time = new Date();
    const formattedTime = formatTime(time);
    
    // UI Update
    const container = mode === 'scalp' ? document.getElementById('scalp-signals-container') : document.getElementById('swing-signals-container');
    const eState = mode === 'scalp' ? document.getElementById('scalp-empty-state') : document.getElementById('swing-empty-state');
    
    if (eState) eState.style.display = 'none';
    
    const tradeId = `trade-${symbol}-${Date.now()}`;
    const card = document.createElement('div');
    card.id = tradeId;
    card.className = 'liquid-card p-4 signal-card-new flex flex-col gap-4 cursor-pointer group';
    
    // Add click listener for chart
    card.addEventListener('click', () => {
        openChart(symbol);
    });
    
    // Category Colors
    let catColorClass = 'bg-yellow-100 text-yellow-700 border-yellow-200';
    if (chanceCategory === 'High') catColorClass = 'bg-emerald-100 text-emerald-700 border-emerald-200';
    else if (chanceCategory === 'Medium') catColorClass = 'bg-blue-100 text-blue-700 border-blue-200';
    
    // Default mock trade plan if not provided
    if (!tradePlan) {
        tradePlan = { entry: price, pullback: price * 0.99, target1: price * 1.02, target2: price * 1.05 };
    }
    
    card.innerHTML = `
        <div class="flex items-center justify-between">
            <div class="flex items-center gap-4">
                <div class="w-10 h-10 rounded bg-gray-50 border border-gray-200 flex items-center justify-center font-mono font-medium text-sm text-black shrink-0 shadow-sm">
                    ${symbol.replace('USDT', '')}
                </div>
                <div>
                    <div class="flex items-center gap-2 mb-1">
                        <h3 class="font-semibold text-black text-base group-hover:underline">${symbol}</h3>
                        <span class="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded border ${catColorClass} shadow-sm">
                            ${chanceScore}% ${chanceCategory} Prob
                        </span>
                    </div>
                    <div class="flex gap-3 text-xs text-gray-500">
                        <span>${formattedTime}</span>
                        <span class="text-black font-medium"><i class="fa-solid fa-fire text-trade-up"></i> ${volAnomalyRatio.toFixed(1)}x Vol Surge</span>
                    </div>
                    <div class="mt-1 flex items-center gap-1 text-[10px] text-indigo-600 bg-indigo-50 border border-indigo-100 px-1.5 py-0.5 rounded w-fit font-medium">
                        <i class="fa-solid fa-microchip"></i> Pattern Detected: ${pattern}
                    </div>
                </div>
            </div>
            <div class="text-right flex flex-col items-end gap-1 shrink-0 relative pr-6">
                <button class="absolute top-0 right-0 text-gray-300 hover:text-red-500 transition-colors bg-white hover:bg-red-50 rounded w-5 h-5 flex items-center justify-center -mt-1 -mr-1" onclick="document.getElementById('${tradeId}').remove(); event.stopPropagation();" title="Dismiss from UI (AI will still track in background)">
                    <i class="fa-solid fa-xmark text-xs"></i>
                </button>
                <div class="font-mono font-semibold text-black text-lg leading-none transition-colors duration-300" id="live-price-${tradeId}">$${formatNumber(price)}</div>
                <div class="text-xs font-medium ${momentum >= 0 ? 'text-trade-up' : 'text-trade-down'}">
                    +${momentum.toFixed(2)}% in 60s
                </div>
            </div>
        </div>
        
        <!-- AI Trade Plan Component -->
        <div class="mt-1 border-t border-gray-100 pt-3 flex flex-col gap-2 relative">
            <div class="flex items-center justify-between text-[10px] uppercase font-bold text-gray-400">
                <div class="flex items-center gap-2">
                    <span class="flex items-center gap-1 text-black"><i class="fa-solid fa-brain"></i> AI Trade Plan</span>
                    <span class="trade-status-badge">
                        <span class="text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded font-bold">Waiting for Pullback</span>
                    </span>
                </div>
                <div class="flex items-center gap-2">
                    <span class="live-pnl text-xs font-bold text-gray-400"></span>
                    <span class="text-emerald-600 bg-emerald-50 border border-emerald-100 px-1.5 py-0.5 rounded flex items-center gap-1">
                        <i class="fa-solid fa-shield-halved"></i> Whale Trap Filtered
                    </span>
                </div>
            </div>
            <div class="grid grid-cols-4 gap-2 text-center">
                <div class="bg-gray-50 rounded p-1.5 border border-gray-200 shadow-sm transition-transform group-hover:-translate-y-0.5">
                    <div class="text-[9px] text-gray-500 font-bold mb-0.5 uppercase tracking-wide">Entry Zone</div>
                    <div class="text-[11px] font-mono font-bold text-black">$${formatNumber(tradePlan.entry)}</div>
                </div>
                <div class="bg-gray-50 rounded p-1.5 border border-gray-200 shadow-sm transition-transform group-hover:-translate-y-0.5 delay-75">
                    <div class="text-[9px] text-gray-500 font-bold mb-0.5 uppercase tracking-wide">Pullback Rgn</div>
                    <div class="text-[11px] font-mono font-bold text-black">$${formatNumber(tradePlan.pullback)}</div>
                </div>
                <div class="bg-emerald-50 rounded p-1.5 border border-emerald-200 shadow-sm transition-transform group-hover:-translate-y-0.5 delay-100">
                    <div class="text-[9px] text-emerald-700 font-bold mb-0.5 uppercase tracking-wide">Target 1</div>
                    <div class="text-[11px] font-mono font-bold text-emerald-700">$${formatNumber(tradePlan.target1)}</div>
                </div>
                <div class="bg-emerald-50 rounded p-1.5 border border-emerald-200 shadow-sm transition-transform group-hover:-translate-y-0.5 delay-150">
                    <div class="text-[9px] text-emerald-700 font-bold mb-0.5 uppercase tracking-wide">Target 2</div>
                    <div class="text-[11px] font-mono font-bold text-emerald-700">$${formatNumber(tradePlan.target2)}</div>
                </div>
            </div>
        </div>
    `;
    
    container.insertBefore(card, container.firstChild);
    
    // Register to active trades
    if (tradePlan) {
        activeTrades[tradeId] = {
            id: tradeId,
            symbol: symbol,
            plan: tradePlan,
            status: 'waiting' // waiting, active, tg1, tg2, sl
        };
    }
    
    // Limit to 50 cards
    if (container.children.length > 51) { // 50 + empty state
        container.removeChild(container.lastChild);
    }
    
    // Play Sound
    if (audioToggle.checked) {
        alertSound.currentTime = 0;
        alertSound.play().catch(e => console.log("Audio play blocked by browser", e));
    }
    
    // Desktop Notification
    if (desktopToggle.checked && "Notification" in window && Notification.permission === "granted") {
        new Notification(`Breakout Detected: ${symbol}`, {
            body: `Price: $${price} | Surge: +${momentum.toFixed(2)}% | Vol: $${(volume/1000000).toFixed(1)}M`,
            icon: 'https://cdn-icons-png.flaticon.com/512/2916/2916119.png'
        });
    }
};

// Bouncing effect for scroll containers
function applyElasticBounce(scrollContainer, elementToAnimate = scrollContainer) {
    if (!scrollContainer || !elementToAnimate) return;
    
    let isBouncing = false;

    function triggerBounce(direction) {
        if (isBouncing) return;
        isBouncing = true;
        const bounceClass = direction === 'top' ? 'bounce-top' : 'bounce-bottom';
        
        elementToAnimate.classList.add(bounceClass);
        
        setTimeout(() => {
            elementToAnimate.classList.remove(bounceClass);
            isBouncing = false;
        }, 600);
    }

    scrollContainer.addEventListener('wheel', (e) => {
        const scrollTop = scrollContainer.scrollTop;
        const isScrollingDown = e.deltaY > 0;

        if (isScrollingDown && Math.ceil(scrollTop + scrollContainer.clientHeight) >= scrollContainer.scrollHeight) {
            triggerBounce('bottom');
        } else if (!isScrollingDown && scrollTop <= 0) {
            triggerBounce('top');
        }
    });

    let touchStartY = 0;
    scrollContainer.addEventListener('touchstart', (e) => {
        touchStartY = e.touches[0].clientY;
    }, { passive: true });

    scrollContainer.addEventListener('touchmove', (e) => {
        const touchY = e.touches[0].clientY;
        const deltaY = touchStartY - touchY;
        const scrollTop = scrollContainer.scrollTop;
        const isScrollingDown = deltaY > 0;

        if (isScrollingDown && Math.ceil(scrollTop + scrollContainer.clientHeight) >= scrollContainer.scrollHeight) {
            triggerBounce('bottom');
        } else if (!isScrollingDown && scrollTop <= 0) {
            triggerBounce('top');
        }
    }, { passive: true });
}

applyElasticBounce(scalpSignalsContainer);
applyElasticBounce(swingSignalsContainer);

// Apply to right pairs panel, animating ONLY the inner list to avoid WebKit backdrop-filter invisibility bugs on the parent
const rightSidebar = document.querySelector('aside.w-80.hidden.xl\\:flex');
if (rightSidebar) {
    applyElasticBounce(rightSidebar, document.getElementById('movers-container'));
}

// Render Movers
const updateMoversUI = () => {
    // Sort all pairs by 24h price change
    const sorted = Object.values(pairsData)
        .filter(p => p.v > config.minVolume && p.symbol !== 'BTCUSDT' && p.symbol !== 'ETHUSDT')
        .sort((a, b) => b.P - a.P)
        .slice(0, 8); // Top 8
        
    if (sorted.length === 0) return;
    
    moversContainer.innerHTML = '';
    sorted.forEach((p, index) => {
        const div = document.createElement('div');
        div.className = 'mover-item liquid-card flex items-center justify-between p-3 cursor-default';
        
        const isUp = p.P >= 0;
        const colorClass = isUp ? 'text-trade-up' : 'text-trade-down';
        
        div.innerHTML = `
            <div class="flex items-center gap-3">
                <div class="text-xs font-mono text-gray-400 w-4">${index + 1}</div>
                <div>
                    <div class="font-semibold text-black text-sm">${p.symbol.replace('USDT', '')}</div>
                    <div class="text-[10px] text-gray-500">Vol $${(p.v / 1000000).toFixed(1)}M</div>
                </div>
            </div>
            <div class="text-right">
                <div class="font-mono text-sm text-black font-medium">$${formatNumber(p.c)}</div>
                <div class="text-xs font-medium ${colorClass}">${parseFloat(p.P).toFixed(2)}%</div>
            </div>
        `;
        moversContainer.appendChild(div);
    });
};

let lastBtcPrice = 0;

// Update global stats
const updateStatsUI = () => {
    if (btcPrice && btcPrice !== lastBtcPrice) {
        btcPriceEl.textContent = `$${formatNumber(btcPrice)}`;
        
        // Add flash animation
        btcPriceEl.classList.remove('update-up', 'update-down');
        // Force reflow
        void btcPriceEl.offsetWidth;
        btcPriceEl.classList.add(btcPrice > lastBtcPrice ? 'update-up' : 'update-down');
        
        lastBtcPrice = btcPrice;
    }
    const usdtPairsCount = Object.keys(pairsData).length;
    scannedCountEl.textContent = usdtPairsCount;
};

// AI Pattern Recognition Engine
const detectPattern = (history, currentPrice, high24h) => {
    if (!history || history.length < 10) return "Momentum Surge";
    
    let minP = history[0].p;
    let maxP = history[0].p;
    for(let t of history) {
        if(t.p < minP) minP = t.p;
        if(t.p > maxP) maxP = t.p;
    }
    
    const proximity = currentPrice / high24h;
    
    // Pattern Heuristics based on short-term price action and 24h context
    if (proximity >= 0.995) {
        return "Cup & Handle Breakout";
    } else if (proximity >= 0.985) {
        return "Ascending Triangle";
    }
    
    const oldestP = history[0].p;
    if (minP < oldestP && currentPrice > oldestP) {
        return "Double Bottom (Micro)";
    }
    
    if (currentPrice >= maxP) {
        return "Bull Flag Breakout";
    }
    
    return "Volume Accumulation";
};

// Algorithm Core
const processTicker = (ticker) => {
    // We only care about USDT pairs
    if (!ticker.s.endsWith('USDT')) return;
    
    const symbol = ticker.s;
    const price = parseFloat(ticker.c);
    const volume = parseFloat(ticker.q); // Quote volume (USDT)
    const high24h = parseFloat(ticker.h);
    const priceChangePercent = parseFloat(ticker.P);
    
    // Update active memory
    pairsData[symbol] = { symbol, c: price, v: volume, h: high24h, P: priceChangePercent };
    if (symbol === 'BTCUSDT') btcPrice = price;

    // Filter out low volume early to save CPU
    if (volume < config.minVolume) return;
    
    const now = Date.now();
    
    const tradesCount = ticker.n ? parseFloat(ticker.n) : 0;
    
    // Live Trade Tracking
    Object.values(activeTrades).forEach(trade => {
        if (trade.symbol === symbol && trade.status !== 'sl' && trade.status !== 'tg2') {
            const plan = trade.plan;
            const tradeCard = document.getElementById(trade.id);
            
            // Note: We don't delete from activeTrades immediately if card is missing.
            // We keep calculating so the AI can learn.
            
            let pnlEl, statusEl, priceEl;
            if (tradeCard) {
                pnlEl = tradeCard.querySelector('.live-pnl');
                statusEl = tradeCard.querySelector('.trade-status-badge');
                priceEl = document.getElementById(`live-price-${trade.id}`);
                
                // Update live price on the card
                if (priceEl) {
                    const currentStr = priceEl.textContent.replace('$', '');
                    const currentVal = parseFloat(currentStr);
                    if (price !== currentVal && !isNaN(currentVal)) {
                        priceEl.classList.remove('text-trade-up', 'text-trade-down', 'text-black');
                        priceEl.classList.add(price > currentVal ? 'text-trade-up' : 'text-trade-down');
                        setTimeout(() => {
                            if (priceEl) {
                                priceEl.classList.remove('text-trade-up', 'text-trade-down');
                                priceEl.classList.add('text-black');
                            }
                        }, 300);
                    }
                    priceEl.textContent = `$${formatNumber(price)}`;
                }
            }
            
            if (trade.status === 'waiting') {
                if (price <= plan.pullback) { // Pulled back to entry!
                    trade.status = 'active';
                    if (tradeCard) {
                        statusEl.innerHTML = '<span class="text-blue-700 bg-blue-100 px-1.5 py-0.5 rounded font-bold animate-pulse">Trade Active</span>';
                        pnlEl.textContent = '0.00%';
                        pnlEl.className = 'live-pnl text-xs font-bold text-gray-500';
                    }
                    if (config.audioAlerts) {
                        const pbSound = document.getElementById('pullback-sound');
                        if (pbSound) pbSound.play().catch(()=>{});
                    }
                }
            } else if (trade.status === 'active' || trade.status === 'tg1') {
                const pnl = ((price - plan.pullback) / plan.pullback) * 100;
                
                if (tradeCard) {
                    pnlEl.textContent = `${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}%`;
                    pnlEl.className = `live-pnl text-xs font-bold ${pnl >= 0 ? 'text-trade-up' : 'text-trade-down'}`;
                }
                
                if (price <= plan.sl) {
                    trade.status = 'sl';
                    if (tradeCard) statusEl.innerHTML = '<span class="text-red-700 bg-red-100 px-1.5 py-0.5 rounded font-bold">SL Hit ❌</span>';
                    updateAILearning(trade.pattern || 'Bull Flag Breakout', false);
                } else if (price >= plan.target2) {
                    trade.status = 'tg2';
                    if (tradeCard) statusEl.innerHTML = '<span class="text-emerald-700 bg-emerald-100 px-1.5 py-0.5 rounded font-bold">TG2 Hit 🚀</span>';
                    updateAILearning(trade.pattern || 'Bull Flag Breakout', true);
                    if (config.audioAlerts) {
                        const tgSound = document.getElementById('success-sound');
                        if (tgSound) tgSound.play().catch(()=>{});
                    }
                } else if (price >= plan.target1 && trade.status !== 'tg1') {
                    trade.status = 'tg1';
                    if (tradeCard) statusEl.innerHTML = '<span class="text-emerald-700 bg-emerald-100 px-1.5 py-0.5 rounded font-bold">TG1 Hit 🎯</span>';
                    if (config.audioAlerts) {
                        const tgSound = document.getElementById('success-sound');
                        if (tgSound) tgSound.play().catch(()=>{});
                    }
                }
            }
        }
    });
};
let ws;

const connectWS = () => {
    wsStatus.textContent = "Connecting...";
    const wsInd = document.getElementById('ws-indicator');
    if (wsInd) wsInd.className = "w-1.5 h-1.5 rounded-full bg-yellow-500 animate-pulse";
    
    ws = new WebSocket('wss://fstream.binance.com/ws/!ticker@arr');
    
    ws.onopen = () => {
        wsStatus.textContent = "Connected";
        if (wsInd) wsInd.className = "w-1.5 h-1.5 rounded-full bg-trade-up";
    };
    
    ws.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            data.forEach(ticker => processTicker(ticker));
        } catch (e) {
            console.error("Parse error", e);
        }
    };
    
    ws.onclose = () => {
        wsStatus.textContent = "Disconnected";
        if (wsInd) wsInd.className = "w-1.5 h-1.5 rounded-full bg-trade-down";
        setTimeout(connectWS, 3000);
    };
    
    ws.onerror = (err) => {
        console.error("WS Error", err);
    };
};
// Local Python Backend Connection
let localWs;
const connectLocalWS = () => {
    localWs = new WebSocket('ws://localhost:8765');
    
    localWs.onopen = () => {
        console.log("Connected to Python Backend Engine!");
    };
    
    localWs.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            if (data.type === 'signal') {
                const { mode, symbol, price, momentum, volume, chanceScore, volAnomalyRatio, tradePlan, pattern } = data;
                const cCat = chanceScore >= 85 ? 'High' : chanceScore >= 70 ? 'Medium' : 'Low';
                
                triggerAlert(symbol, price, momentum, volume, chanceScore, cCat, volAnomalyRatio, tradePlan, pattern, mode);
                
                if (config.tradingMode !== mode) {
                    const dotId = mode === 'scalp' ? 'dot-scalp' : 'dot-swing';
                    const dot = document.getElementById(dotId);
                    if (dot) dot.classList.remove('hidden');
                }
            }
        } catch (e) {
            console.error(e);
        }
    };
    
    localWs.onclose = () => {
        console.log("Disconnected from Python Backend. Reconnecting...");
        setTimeout(connectLocalWS, 3000);
    };
};
connectLocalWS();

// Init UI Loops
setInterval(updateStatsUI, 1000);
setInterval(updateMoversUI, 3000); // Update movers every 3 seconds

// For testing/demo purposes: simulate a breakout after 5 seconds to show UI
setTimeout(() => {
    triggerAlert('SOLUSDT', 145.24, 2.34, 15000000, 95, 'High', 4.2, null, 'Cup & Handle Breakout');
}, 5000);

// Start connection
connectWS();
