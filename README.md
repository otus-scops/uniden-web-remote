# Uniden Web Remote & Memory Manager (`uniden-web-remote`)

[English] | [日本語](README.ja.md)

A modern, containerized Web application for remote control, Web-based live audio streaming, automatic hit recording, and **spreadsheet-style memory programming** for **Uniden Bearcat Scanners** (BCT15X and compatible DMA models).

Runs seamlessly on Docker and is accessible from any modern Web browser (desktop, tablet, or mobile). Built-in multi-language support (English & Japanese).

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![Docker](https://img.shields.io/badge/Docker-Ready-2496ED.svg?logo=docker&logoColor=white)](docker-compose.yml)
[![Node.js](https://img.shields.io/badge/Node.js-v20-339933.svg?logo=nodedotjs&logoColor=white)](package.json)

<p align="center">
  <img src="assets/dashboard-cyber-en.png" alt="Uniden Bearcat BCT15X Web Remote Main Dashboard" width="100%">
</p>

---

## 🎯 Design Philosophy & Target Use Case

Unlike traditional desktop applications designed primarily for direct, tethered operation beside a local PC, **`uniden-web-remote` is designed with the philosophy of running a scanner 24/7 on a home server for continuous recording, while providing convenient remote listening and virtual control from any browser**.

While prioritizing **unattended 24/7 recording reliability, effortless setup via Docker containerization, and the flexibility to access your scanner from any client device across your home network**, the modern **WebSocket + Web Audio API pipeline delivers an ultra-low latency (100–300ms) listening experience** that brings web playback virtually in sync with the physical scanner hardware.

- **Intended Usage Style**:
  Deploy the Docker container on a home server, Linux box, mini-PC, or Raspberry Pi connected to the scanner, then access the Web interface from any machine on your LAN (desktop, laptop, tablet, or smartphone) via `http://<server-local-ip>:3000`. (Running locally on a single machine via `http://localhost:3000` is also fully supported).

---

## ⚡ Ultra Low-Latency Live Audio & Real-Time Sync

- **Sub-Second Streaming via WebSocket + Web Audio API (100–300ms)**:
  Bypasses the multi-second buffering of standard HTML5 `<audio>` tags by streaming raw PCM chunks directly over WebSocket and rendering them immediately via the Web Audio API (`AudioContext`).
- **Complete Synchronization with Display & Commands**:
  When squelch opens or when you execute commands like **Hold**, **Scan**, or **Temporary Lockout**, the incoming audio matches the on-screen channel metadata in real time.
- **Automatic Drift Compensation**:
  Continuously monitors jitter buffer depth and automatically catches up to the live edge if network hiccups occur, preventing delay accumulation over long listening sessions.

---

### 📻 Supported Models
- **Tested & Verified**: **Uniden Bearcat BCT15X**
- **Architecture Compatibility**: Designed around the Uniden DMA (Dynamic Memory Architecture) serial command protocol. Should be compatible with or easily adaptable to **BCD996XT**, **BCD996P2**, **BCD396XT**, **BCD325P2**, **BC346XT**, etc. *(Community testing and PRs are warmly welcomed!)*

---

## 🌟 Key Features & Interface Tour (Community Edition)

### 1. 📡 Real-Time Virtual Scanner Dashboard
Complete control center showing live frequency/TGID, alpha tags (System / Department / Channel), modulation mode, CTCSS/DCS tone, and RSSI signal level meter in real time. Includes an interactive virtual faceplate mimicking physical rotary knob and keypad, ultra-low latency live audio player, and instant transmission recording playback.

Toggle between two display styles with one click:
- **🖥️ Cyber Mode**: High-visibility neon frequency readout and fluid signal bar
- **📟 Virtual LCD Mode**: Faithful retro reproduction of the original amber backlit hardware LCD

<p align="center">
  <img src="assets/dashboard-lcd.png" alt="Virtual Hardware LCD Mode" width="100%">
  <em>▲ Virtual Hardware LCD Mode with full menu and navigation simulation</em>
</p>

### 2. 📝 Full Spreadsheet Memory Editor
In-browser channel and bank manager with Uniden Dynamic Memory Architecture (DMA) serial synchronization:
- **Scanner DMA Sync**: Full bulk download and upload of Systems, Groups, and Channels
- **Spreadsheet Grid Editing**: Inline edit frequency, modulation, tone/code, lockout, priority, and attenuator
- **Excel & Google Sheets Batch Paste**: Effortlessly copy and paste channel blocks from any spreadsheet
- **Automated Safety Backups**: Automatically creates timestamped JSON backups before hardware programming
- **CSV & JSON I/O**: Export and import memory archives seamlessly

<p align="center">
  <img src="assets/memory-editor-en.png" alt="Spreadsheet-Style Memory Editor" width="100%">
  <em>▲ Full Spreadsheet Memory Editor (Excel batch paste & DMA hardware sync)</em>
</p>

### 3. Additional Powerful Capabilities
- 🎙️ **Automatic Transmission Recording**: Automatically records audio when squelch opens; tags and splits files per transmission (MP3 format) with in-browser playback and search
- 📋 **Activity Logging**: Chronological reception history logging with filterable query options and CSV export
- 🌐 **Internationalization (i18n)**: One-click instant language switching (English 🇺🇸 / Japanese 🇯🇵)
- 📱 **Progressive Web App (PWA) Ready**: Install directly on mobile (iOS/Android) or desktop as a standalone app
- 🖥️ **Mock Simulation Mode**: Test and explore all UI features without connecting physical scanner hardware

---

## 🚀 Quick Start

### 1. Hardware Connections

1. Connect the **BCT15X front PC/IF port** to your Linux host via a USB-to-Serial cable.
2. Connect the **BCT15X headphone / record output jack** to your PC Line-In or USB Audio Adapter.

```bash
# Verify USB Serial port
ls /dev/ttyUSB*

# Verify ALSA audio capture devices
arecord -l
```

```

### 2. Configure Environment Variables (`.env`)

Hardware paths, audio parameters, storage retention, and authentication credentials can be easily managed via a `.env` file.
Copy the provided template to get started:

```bash
cp .env.example .env
nano .env  # Edit with your preferred text editor
```

*Note: If no `.env` file is created, default values defined in `docker-compose.yml` will be used automatically.*

### 3. Launch with Docker Compose

```bash
# Clone or navigate to the repository
cd "Remote for docker"

# Build and start container in detached mode
docker compose up -d --build

# Inspect live container logs
docker compose logs -f scanner
```

Open your browser and navigate to:
- **From another device on your LAN (Recommended / Primary use case)**:
  `http://<server-local-ip>:3000` (e.g., `http://192.168.1.50:3000`)
- **From the server itself**:
  `http://localhost:3000`

---

## ⚙️ Environment Variables Reference

All configurable options supported in `.env` or `docker-compose.yml`.

### Hardware & Connectivity
| Variable | Default | Description |
|:---|:---|:---|
| `SERIAL_PORT` | `/dev/ttyUSB0` | BCT15X serial port device path (`dmesg` or `ls /dev/ttyUSB*`) |
| `SERIAL_BAUD` | `115200` | Baud rate (must match scanner `Set Serial Port` setting) |
| `AUDIO_DEVICE` | `plughw:1,0` | ALSA audio capture device (`arecord -l` to find card/device) |

### Audio & Recording Quality
| Variable | Default | Description |
|:---|:---|:---|
| `AUDIO_FORMAT` | `mp3` | Recording audio format (`mp3`) |
| `AUDIO_SAMPLE_RATE` | `16000` | Sampling rate in Hz. Optimized for narrow-band radio voice communications |
| `AUDIO_CHANNELS` | `1` | Channel count (1: Mono / 2: Stereo) |
| `AUDIO_BITRATE` | `32` | MP3 bitrate in kbps. Preserves voice clarity while cutting storage by ~50% (~14.4MB/hr) |
| `AUTO_RECORD` | `true` | Enable automatic transmission recording when squelch opens |
| `SILENCE_THRESHOLD` | `1.0` | SoX silence detection threshold (%) |
| `SILENCE_DURATION` | `3.0` | Silence duration to consider transmission ended (seconds) |
| `FILENAME_TEMPLATE` | `{system}/{department}/{channel}/{date}_{time}_{freq}` | File & directory template (`/` creates automatic nested folders) |

### Storage Retention Policy
| Variable | Default | Description |
|:---|:---|:---|
| `RETENTION_DAYS` | `30` | Number of days to keep recordings before auto-cleanup (`0` = keep forever) |
| `MAX_STORAGE_MB` | `0` | Max storage limit in MB. Oldest files are pruned when exceeded (`0` = unlimited) |
| `CLEANUP_INTERVAL_HOURS` | `12` | Interval in hours between automated cleanup cycles |

### Role-Based Access Authentication
| Variable | Default | Description |
|:---|:---|:---|
| `AUTH_ENABLED` | `false` | Enable access protection (`true` enforces role separation, `false` gives full public control) |
| `OPERATOR_PASSWORD`| (unset) | Password for Operator role (grants full scanner keypad control, memory editor, file deletion) |
| `LISTENER_PASSWORD`| (unset) | Password for Listener role (grants status viewing and live/recorded audio streaming) |
| `AUTH_SECRET` | (auto) | Secret string for HMAC-SHA256 session token generation |

### Scanner Timing & System
| Variable | Default | Description |
|:---|:---|:---|
| `POLL_INTERVAL` | `200` | Fast status polling interval in ms (GLG command) |
| `STATUS_INTERVAL` | `1000` | Full status polling interval in ms (STS command) |
| `RECEPTION_TIMEOUT`| `1500` | Signal drop threshold in ms to mark transmission as ended |
| `MAX_RECEPTION_DURATION_SEC` | `0` | Max consecutive reception duration in seconds before forcing scan resume (`0` = disabled/OFF) |
| `MAX_LOG_ENTRIES` | `10000` | Maximum reception activity log records retained in memory |
| `TZ` | `Asia/Tokyo` | Container timezone |
| `MOCK_MODE` | `false` | Enable simulation mode without physical hardware |

> [!TIP]
> **💡 Design Intent for Max Reception Duration (Forced Scan Resume)**:
> - **Recommended Hybrid Setup**:
>   This feature is specifically designed to be paired with **hardware positive delay (e.g., standard `+2s` delay set on the scanner itself)** while emulating negative delay via software.
>   - **Scanner Hardware Delay (`+2s`)**: Holds the channel across pauses to ensure two-way conversations and replies aren't cut short.
>   - **Software Max Duration (e.g., `30s`)**: Prevents the scanner from getting permanently stuck on weak carrier noise or long uninterrupted chatter, automatically forcing scan resumption.
> - **When to Keep this Feature Disabled (`0` / OFF)**:
>   If your scanner is already configured with hardware negative delay (`-2s`, `-5s`, `-10s`) or if you intend to listen to long continuous transmissions without interruption, set this value to `0` (Unlimited / OFF) in the Web UI or via this environment variable. When set to `0`, all timer and scan resume routines are completely bypassed without interfering with hardware behavior.

---

## 💻 Local Development (Mock Mode)

To run the application locally with mock scanner data:

```bash
npm install
npm run mock
```
Then visit `http://localhost:3000`.

---

## ⚠️ Legal Disclaimer

### Trademark Notice
- This project is an independent open-source initiative and is **not affiliated with, endorsed by, sponsored by, or associated with Uniden America Corporation** or any of its subsidiaries.
- "Uniden", "Bearcat", and associated product names are registered trademarks or trademarks of Uniden America Corporation. Any use of these names is purely for identification and hardware compatibility reference purposes (nominative fair use).

### Regulatory Compliance & Privacy of Communications
- This software is provided strictly for **lawful private use** on a local personal network (LAN) in full compliance with all applicable local, national, and international laws and telecommunications regulations.
- Users are solely responsible for ensuring that their use of this software complies with their jurisdiction's radio communication laws (e.g., the Japanese Radio Act Article 59 regarding the protection of communication privacy, the US Electronic Communications Privacy Act, and equivalent regional legislation):
  - **No Public Re-Broadcasting**: Do not re-transmit, publish, or stream live intercepted radio communications over the public Internet to unrestricted audiences without proper legal authorization. Always enable authentication (`AUTH_ENABLED=true`) if exposing endpoints beyond your immediate private network.
  - **Recorded Audio & Logs**: Do not distribute, publicly share, or upload private intercepted transmission audio or frequency activity records to public platforms or social media.
- The authors and contributors assume no liability and shall not be held responsible for any misuse, statutory violations, or damages resulting from the use of this software. Use entirely at your own risk.

---

## 📄 License

This project is licensed under the **Apache License 2.0**.
See the [LICENSE](LICENSE) file for complete details.

