# 小伴直连遥控网页

Static personal ESP32 assistant. Visitors use the owner's private QR, without an account login.

The page connects through TLS WebSocket to the public EMQX test broker. Messages use
AES-256-CBC with independent HMAC-SHA256 authentication, direction labels and timestamps.
This repository contains no owner keys, access links, model keys, Wi-Fi credentials,
computer MAC address or screenshots. The pairing fragment is not sent to the static
hosting server. A browser saves it after an authenticated board heartbeat.

The base firmware supports chat, memory, status, clear and restart. Conversation
history is kept in the browser for seven days; persistent memories stay on the board.
Computer extension v2 stores up to eight named computer profiles on the board. Each wake
request specifies a profile ID and its expected Ethernet MAC. Configuration writes use
revision checks; stale edits, duplicate MACs and unconfigured targets are rejected. The board
acknowledges sending wake packets; that acknowledgement does not prove a successful boot.

Computer settings show validation, pending, success and retry feedback beside Save.
Unsaved edits stay in this browser across reloads. A successful save is checked against
the profile returned by the board. Revision conflicts affecting another computer are
refreshed and retried once; changes to the same computer preserve the draft and require
an explicit choice before overwriting.

The computer tab can send a Wake-on-LAN request without a Windows companion. Every
explicit wake request sends packets, even when a recent heartbeat says the PC is online.
Wake-only finishes after a board receipt matching the computer ID and Ethernet MAC;
it reports transmission, never confirmed power-on. Opening AskLink (连连控) and displaying
an encrypted window screenshot require the owner's separately installed Windows companion.
The combined workflow waits up to 90 seconds for a new companion heartbeat after sending
the wake request. Stop-waiting prevents subsequent desktop operations and does not undo
the wake packets already sent. A timeout does not imply that the PC is powered off.
Each computer has its own derived encryption/authentication keys and MQTT topic. Desktop
commands and receipts also bind the computer ID and expected Ethernet MAC. The selector
is locked while an operation is running, and changing computers clears the displayed image.
The enrollment package contains only that computer's scoped keys, never owner/board keys.
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
Computer controls require extension v2 and a separately enrolled companion on each PC.
The old single-computer channel is intentionally not used by v2.
The public broker has no uptime guarantee. HTTPS and WSS internet access are required;
the service worker only caches the static page, not a connection to an offline device.

Delivery diagnostics distinguish browser submission, first transmission, board execution
and receipt arrival. Firmware stores execution times in the existing bounded journal;
the latest wake summary remains visible after receipt acknowledgement or a board reboot.
Older receipts without timestamps are labelled as old records. These timestamps do not
prove that the computer powered on. Diagnostic exports exclude keys, chat and images.
The transport reconnects silent sockets and checks connection freshness on foreground
resume; queued commands keep their original ID and expiry across reconnects.
