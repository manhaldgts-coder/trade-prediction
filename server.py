import asyncio
import json
import websockets
import time

# --- STATE ---
pairs_data = {}
price_history = {}
ai_memory = {"patterns": {}}
clients = set()
last_notified = {"scalp": {}, "swing": {}}
COOLDOWN_SECONDS = 300

config = {
    "minVolume": 15000000,
    "sensitivityLevel": 3
}

# --- ALGORITHM LOGIC ---
def get_momentum_threshold():
    level = config["sensitivityLevel"]
    if level == 1: return 3.0
    if level == 2: return 2.0
    return 1.0

def process_ticker(ticker):
    symbol = ticker.get('s')
    if not symbol or not symbol.endswith('USDT'): return None

    price = float(ticker.get('c', 0))
    volume = float(ticker.get('q', 0))
    high24h = float(ticker.get('h', 0))
    price_change_percent = float(ticker.get('P', 0))
    trades_count = float(ticker.get('n', 0))
    now = time.time()

    pairs_data[symbol] = {'c': price, 'v': volume, 'h': high24h, 'P': price_change_percent}

    if volume < config["minVolume"]: return None

    if symbol not in price_history:
        price_history[symbol] = []

    price_history[symbol].append({'t': now, 'p': price, 'v': volume, 'n': trades_count})

    # Keep only last 60 seconds
    price_history[symbol] = [pt for pt in price_history[symbol] if now - pt['t'] <= 60]

    if len(price_history[symbol]) < 5: return None

    oldest = price_history[symbol][0]
    time_diff = now - oldest['t']
    
    if time_diff < 10: return None

    momentum_percent = ((price - oldest['p']) / oldest['p']) * 100
    volume_traded = volume - oldest['v']
    trades_in_window = trades_count - oldest['n']

    avg_vol_per_sec = oldest['v'] / 86400 if oldest['v'] > 0 else 1
    expected_vol = avg_vol_per_sec * time_diff
    vol_anomaly_ratio = volume_traded / expected_vol if expected_vol > 0 else 1.0

    is_whale_trick = 0 < trades_in_window < 15 and volume_traded > 1000000
    if is_whale_trick: return None

    threshold = get_momentum_threshold()
    proximity = price / high24h if high24h > 0 else 0

    # Scalp
    is_scalp = False
    scalp_plan = None
    scalp_score = 50
    if momentum_percent >= threshold and proximity >= 0.985 and vol_anomaly_ratio >= 2.0:
        is_scalp = True
        scalp_score += min(20, (vol_anomaly_ratio - 2.0) * 5)
        scalp_score += min(15, (momentum_percent - threshold) * 15)
        if proximity >= 1.0: scalp_score += 15
        else: scalp_score += ((proximity - 0.985) / 0.015) * 15
        scalp_plan = {"entry": price, "pullback": price * 0.992, "target1": price * 1.015, "target2": price * 1.03, "sl": price * 0.992 * 0.99}

    # Swing
    is_swing = False
    swing_plan = None
    swing_score = 50
    if price_change_percent >= 3.0 and proximity >= 0.95 and vol_anomaly_ratio >= 1.5 and momentum_percent >= 0.2:
        is_swing = True
        swing_score += min(25, (price_change_percent - 3.0) * 3)
        swing_score += min(20, (vol_anomaly_ratio - 1.5) * 10)
        if proximity >= 0.99: swing_score += 15
        swing_plan = {"entry": price, "pullback": price * 0.95, "target1": price * 1.15, "target2": price * 1.30, "sl": price * 0.95 * 0.95}

    alerts = []
    if is_scalp:
        last_time = last_notified["scalp"].get(symbol, 0)
        if now - last_time > COOLDOWN_SECONDS:
            last_notified["scalp"][symbol] = now
            alerts.append({"type": "signal", "mode": "scalp", "symbol": symbol, "price": price, "momentum": momentum_percent, "volume": volume, "chanceScore": min(99, int(scalp_score)), "volAnomalyRatio": vol_anomaly_ratio, "tradePlan": scalp_plan, "pattern": "Bull Flag Breakout"})
    
    if is_swing:
        last_time = last_notified["swing"].get(symbol, 0)
        if now - last_time > COOLDOWN_SECONDS:
            last_notified["swing"][symbol] = now
            alerts.append({"type": "signal", "mode": "swing", "symbol": symbol, "price": price, "momentum": momentum_percent, "volume": volume, "chanceScore": min(99, int(swing_score)), "volAnomalyRatio": vol_anomaly_ratio, "tradePlan": swing_plan, "pattern": "Macro Consolidation Breakout"})
    
    return alerts

# --- WEBSOCKET HANDLERS ---
async def binance_worker():
    uri = "wss://fstream.binance.com/ws/!ticker@arr"
    while True:
        try:
            print("Connecting to Binance WebSocket...")
            async with websockets.connect(uri) as ws:
                print("Connected to Binance!")
                while True:
                    message = await ws.recv()
                    data = json.loads(message)
                    for ticker in data:
                        alerts = process_ticker(ticker)
                        if alerts:
                            for alert in alerts:
                                await broadcast(alert)
                    
                    # Also broadcast live pair data periodically (e.g., BTC price)
                    if "BTCUSDT" in pairs_data:
                        await broadcast({"type": "price_update", "symbol": "BTCUSDT", "price": pairs_data["BTCUSDT"]["c"]})
        except Exception as e:
            print(f"Binance WS Error: {e}. Reconnecting in 3 seconds...")
            await asyncio.sleep(3)

async def broadcast(message):
    if clients:
        msg_str = json.dumps(message)
        await asyncio.gather(*[client.send(msg_str) for client in clients])

async def client_handler(websocket):
    clients.add(websocket)
    try:
        async for message in websocket:
            data = json.loads(message)
            if data.get("type") == "config_update":
                config.update(data.get("config", {}))
                print(f"Config updated: {config}")
    finally:
        clients.remove(websocket)

async def main():
    print("Starting Python Engine on ws://localhost:8765")
    # Start the local websocket server
    async with websockets.serve(client_handler, "localhost", 8765):
        # Run the Binance worker concurrently
        await binance_worker()

if __name__ == "__main__":
    asyncio.run(main())
