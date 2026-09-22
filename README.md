# Uniden Web Remote & Memory Manager (`uniden-web-remote`)

[English] | [日本語](README.ja.md)

A modern, containerized Web application for remote control, low-latency live audio streaming, automatic hit recording, and **FreeSCAN-alternative spreadsheet memory programming** for **Uniden Bearcat Scanners** (BCT15X and compatible DMA models).

Runs seamlessly on Docker and is accessible from any modern Web browser (desktop, tablet, or mobile). Built-in multi-language support (English & Japanese).

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![Docker](https://img.shields.io/badge/Docker-Ready-2496ED.svg?logo=docker&logoColor=white)](docker-compose.yml)
[![Node.js](https://img.shields.io/badge/Node.js-v20-339933.svg?logo=nodedotjs&logoColor=white)](package.json)

### 📻 Supported Models
- **Tested & Verified**: **Uniden Bearcat BCT15X**
- **Architecture Compatibility**: Designed around the Uniden DMA (Dynamic Memory Architecture) serial command protocol. Should be compatible with or easily adaptable to **BCD996XT**, **BCD996P2**, **BCD396XT**, **BCD325P2**, **BC346XT**, etc. *(Community testing and PRs are warmly welcomed!)*

---

## 🌟 Key Features (Community Edition / Open Source)

- 📡 **Virtual Control & Real-Time Display**: Live frequency/TGID display, alpha tags (System / Group / Channel), modulation, tone/code (CTCSS/DCS), and RSSI signal level meter.
- 🔊 **Ultra Low-Latency Live Audio**: Listen to scanner audio directly in your browser with HTML5 chunked audio streaming.
- 🎛️ **Full Keypad & Menu Control**: Interactive virtual panel simulating Scan, Hold, Menu, Function, and Direct Numpad entry with volume and squelch adjustments.
- 📝 **FreeSCAN Alternative: Memory Editor**:
  - **Full Scanner Memory Sync**: Complete download and upload of Systems, Groups, and Channels using Uniden DMA (Dynamic Memory Architecture) serial protocol.
  - **Spreadsheet-Style Grid Editor**: Inline editing for Channel Name, Frequency (MHz), Modulation (AUTO/AM/FM/NFM/WFM), Tone/Code (CTCSS/DCS), Lockout, Priority, and Attenuator.
  - **Excel / Spreadsheet Batch Paste**: Easily copy dozens or hundreds of channels from Excel or Google Sheets and batch-import them in one click.
  - **Automated Safety Backups**: Automatically creates timestamped JSON backups prior to scanner memory upload, with one-click restore history.
  - **Import & Export**: Full support for CSV and JSON format backups.
- 🎙️ **Automatic Transmission Recording**: Automatically records audio when squelch opens; tags and splits files per transmission (MP3 format) with in-browser playback and search.
- 📋 **Activity Logging**: Chronological reception history logging with filterable query options and CSV export.
- 🌐 **Internationalization (i18n)**: One-click instant language switching (English 🇺🇸 / Japanese 🇯🇵) with zero page reload.
- 🖥️ **Mock Simulation Mode**: Test and explore all UI features without connecting physical scanner hardware.

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

### 2. Launch with Docker Compose

```bash
# Clone or navigate to the repository
cd "Remote for docker"

# Build and start container in detached mode
docker compose up -d --build

# Inspect live container logs
docker compose logs -f scanner
```

Open your browser and navigate to:
**`http://localhost:3000`**

---

## ⚙️ Environment Variables (`docker-compose.yml`)

| Variable | Default | Description |
|:---|:---|:---|
| `SERIAL_PORT` | `/dev/ttyUSB0` | BCT15X serial port device path |
| `SERIAL_BAUD` | `115200` | Baud rate (default front port speed: 115200) |
| `AUDIO_DEVICE` | `plughw:1,0` | ALSA audio capture device (e.g., `plughw:1,0`) |
| `AUDIO_FORMAT` | `mp3` | Audio format (`mp3`) |
| `AUDIO_SAMPLE_RATE` | `22050` | Audio sample rate (Hz) |
| `AUDIO_BITRATE` | `64` | MP3 bitrate (kbps) |
| `AUTO_RECORD` | `true` | Enable automatic transmission recording |
| `FILENAME_TEMPLATE`| `{date}_{time}_{freq}_{system}_{channel}` | File naming convention template |
| `MOCK_MODE` | `false` | Enable simulation mode without physical hardware |
| `TZ` | `Asia/Tokyo` | Container timezone |

---

## 💻 Local Development (Mock Mode)

To run the application locally with mock scanner data:

```bash
npm install
npm run mock
```
Then visit `http://localhost:3000`.

---

## 📄 License

This project is licensed under the **Apache License 2.0**.
See the [LICENSE](LICENSE) file for complete details.
