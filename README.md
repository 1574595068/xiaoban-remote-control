# 小伴直连遥控网页

Static personal ESP32 assistant. Visitors use the owner's private QR, without an account login.

The page connects through TLS WebSocket to the public EMQX test broker. Messages use
AES-256-CBC with independent HMAC-SHA256 authentication, direction labels and timestamps.
This repository contains no owner keys, access links, model keys, Wi-Fi credentials,
computer MAC address or screenshots. The pairing fragment is not sent to the static
hosting server. A browser saves it after an authenticated board heartbeat.

The base firmware supports chat, memory, status, clear and restart. Conversation
history is kept in the browser for seven days; persistent memories stay on the board.
The computer extension adds a fixed, locally configured Wake-on-LAN target. The board
acknowledges sending the wake packets; that acknowledgement does not prove a successful boot.

The computer tab can wake the computer, open AskLink (连连控), and display an encrypted
window screenshot. This requires the owner's separately installed Windows companion.
Its encryption and authentication keys are derived separately from the board channel.
The companion accepts only status, open-AskLink and screenshot operations; there is no
arbitrary command, shutdown, remote keyboard or continuous recording endpoint.
Screenshots are requested explicitly, cached briefly in companion memory for retries,
and displayed temporarily in the browser without browser history persistence.

The ESP32 must have power independent of the computer. The computer needs Ethernet,
standby power and Wake-on-LAN support in its network adapter and BIOS. Actual wake from
sleep and full shutdown must be verified separately. The companion starts at Windows
user logon, so a computer at the Windows sign-in screen must first be signed in through
the existing remote desktop application. No automatic login or password change is needed
or performed. Locked or protected desktop screenshots return an explanatory error.

Base chat functions remain compatible with the MicroPython assistant firmware 0.3.0.
Computer wake requires the computer-command extension and local target provisioning.
The public broker has no uptime guarantee. HTTPS and WSS internet access are required;
the service worker only caches the static page, not a connection to an offline device.
