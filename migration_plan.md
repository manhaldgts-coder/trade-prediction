# Backend Migration Plan

1. Create a Python backend (`server.py`) using `asyncio` and `websockets` to connect to Binance.
2. The backend will hold the `pairsData`, `priceHistory`, and AI memory.
3. The frontend will connect to a local WebSocket provided by the Python backend.
4. The backend evaluates Scalp/Swing logic and emits `SIGNAL` events to the frontend.
