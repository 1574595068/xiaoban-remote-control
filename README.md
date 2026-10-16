# 小伴直连遥控网页

Static personal ESP32 remote UI. No visitor account or computer relay is required.

The HTTPS page connects to `wss://broker.emqx.io:8084/mqtt`. Device messages use
AES-256-CBC plus an independent HMAC-SHA256 key, direction labels, and timestamps.
The public repository contains no device keys, access links, model keys or Wi-Fi
credentials. The owner receives a private QR; its URL fragment is never sent to
the hosting server. The browser saves it locally only after authenticating a
device heartbeat. Anyone receiving that private QR can control the device.

The firmware permits chat, memory operations, status, clear and restart. It does
not permit arbitrary code execution. Persistent device receipts suppress duplicate
execution when the browser retries. Local conversation history is retained for
seven days; long-term memories remain on the board. Speech uses the browser.

The public MQTT test broker provides no uptime guarantee. The board needs power
and internet access, and the browser needs HTTPS and WSS access. An offline copy
of the page is cached after the first successful visit; device control still needs
internet access.

This site works with the existing MicroPython assistant firmware 0.3.0.
