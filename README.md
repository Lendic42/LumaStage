<p align="center">
  <img src="https://github.com/Lendic42/LumaStage/releases/download/v0.1.0/LumaStage-icon.png" alt="LumaStage" width="128" height="128">
</p>

<h1 align="center">LumaStage</h1>

<p align="center">
  <strong>Открытая VTuber-студия</strong><br>
  Desktop для Windows / macOS + трекер на iPhone с Face ID
</p>

<p align="center">
  <a href="#-скачать"><img src="https://img.shields.io/badge/download-v0.1.0-7c5cff?style=for-the-badge" alt="Download"></a>
  <a href="https://github.com/Lendic42/LumaStage/releases/latest"><img src="https://img.shields.io/github/v/release/Lendic42/LumaStage?style=for-the-badge&color=22c55e" alt="Release"></a>
  <a href="#-лицензия"><img src="https://img.shields.io/badge/license-GPL--3.0-blue?style=for-the-badge" alt="License"></a>
</p>

<p align="center">
  <code>Electron</code> · <code>React</code> · <code>SwiftUI</code> · <code>ARKit</code> · <code>GPL-3.0</code>
</p>

<p align="center">
  🇷🇺 <b>Русский</b> ·
  <a href="README.en.md">🇬🇧 English</a> ·
  <a href="README.ja.md">🇯🇵 日本語</a> ·
  <a href="README.zh.md">🇨🇳 中文</a> ·
  <a href="README.ar.md">🇸🇦 العربية</a> ·
  <a href="README.sr.md">🇷🇸 Српски</a>
</p>

---

## ✨ Что это

LumaStage собирает на сцене **Live2D-модели** (Cubism 3/4/5 и папки из VTube Studio), а мимику снимает **iPhone** по локальной сети.

- 🚫 без аккаунта  
- ☁️ без облака  
- 💳 без подписки  
- 🏠 треккинг остаётся у тебя дома  

---

## 🧩 Из чего состоит

| | Часть | Что делает |
| :---: | --- | --- |
| 🖥️ | **Desktop** | Рендер модели, маппинг, сцены, хоткеи, оверлей под OBS |
| 📱 | **Tracker** | TrueDepth + ARKit на Face ID iPhone, низкая задержка, LAN |
| 📡 | **Протокол** | Открытый TCP / Bonjour — `_lumastage._tcp`, порт `39510` |
| 🔌 | **VTS API** | Plugin API VTube Studio на `ws://127.0.0.1:8001` |

> ⚠️ Проприетарный **Live2D Cubism Core** в репозиторий не входит.  
> Ставится из приложения (официальный CDN Live2D) или из SDK for Web.  
> Подробности → [docs/compatibility.md](docs/compatibility.md)

---

## 📦 Скачать

Готовые сборки → **[Releases](https://github.com/Lendic42/LumaStage/releases/latest)**

| 📁 Файл | 🖥️ Платформа |
| --- | --- |
| `LumaStage-macOS-0.1.0.dmg` | 🍎 macOS · установщик |
| `LumaStage-macOS-0.1.0.zip` | 🍎 macOS · portable |
| `LumaStage-Windows-0.1.0-Setup.exe` | 🪟 Windows · установщик |
| `LumaStage-Windows-0.1.0-Portable.exe` | 🪟 Windows · portable |
| `LumaStage-Tracker-0.1.0-unsigned.ipa` | 📱 iPhone · нужна своя подпись |
| `LumaStage-0.1.0-source.zip` | 🧬 исходники релиза |

### 📱 iPhone (Tracker)

IPA **не подписан**. Ставь через Feather / AltStore / Sideloadly / TrollStore — своим сертификатом.

1. ⬇️ Скачай `LumaStage-Tracker-0.1.0-unsigned.ipa` из релиза  
2. ✍️ Подпиши и установи на iPhone с Face ID  
3. 🖥️ Запусти Desktop, открой пару по **6-значному коду**  
4. 📶 Держи оба устройства в одной Wi‑Fi сети  

> 🔑 Первое подключение: код на десктопе → подтверждение на iPhone.  
> После этого сохраняется локальный токен устройства.

### 🖥️ Desktop

1. ⬇️ Поставь macOS / Windows сборку из релиза  
2. 📥 При первом импорте модели — скачай Cubism Core (нужно согласие с лицензией Live2D)  
3. 📂 Импортируй папку с `*.model3.json` (можно с `*.vtube.json` из VTS)  
4. 📱 Подключи Tracker **или** работай в нейтральной позе без iPhone  

---

## ✅ Что уже есть

| | Фича |
| :---: | --- |
| 🎭 | Импорт Cubism 3/4/5 и метаданных VTube Studio (маппинги, expressions, motions, hotkeys) |
| 🎚️ | Калибровка и сглаживание трекинга, живой редактор face → Live2D |
| 🎬 | Сцены: фон, трансформ модели, PNG / JPG / GIF items, pin к ArtMesh |
| 📹 | Прозрачный always-on-top оверлей под захват в OBS |
| 🧩 | Локальный VTS Plugin API (модели, hotkeys, items, physics, post-processing…) |
| 🔒 | Без облака: pairing только по LAN, токены только на устройствах |

📖 Полная матрица API → [docs/compatibility.md](docs/compatibility.md)  
🏗️ Архитектура → [docs/architecture.md](docs/architecture.md)

---

## 🛠️ Разработка

Нужен **Node.js 22+**.

```bash
npm install
npm run dev          # desktop
npm test
npm run package:mac  # dmg / zip
npm run package:win  # setup / portable
```

### 📁 Структура

```text
apps/desktop           # 🖥️ Electron + React
apps/ios               # 📱 SwiftUI + ARKit tracker
packages/protocol      # 📡 протокол трекинга
packages/vts-api       # 🔌 совместимость VTS Plugin API
packages/scene-core    # 🎬 сцены
packages/tracking-core
packages/model-compat
docs/                  # 📖 docs
```

iOS-проект: `apps/ios`. IPA удобнее собирать на Mac с Xcode.

---

## 📄 Лицензия

Исходники LumaStage — **GPL-3.0-only**.

Live2D Cubism Core, модели и чужие ассеты — по своим лицензиям.  
См. `THIRD_PARTY_NOTICES.md` и [docs/compatibility.md](docs/compatibility.md).

---

## ⭐ Star History

[![Star History Chart](./star-history.png)](https://www.star-history.com/#LumaStage&Date)

<p align="center">
  Made with 💜 for VTubers · <a href="https://github.com/Lendic42/LumaStage/releases/latest">Download v0.1.0</a>
</p>
