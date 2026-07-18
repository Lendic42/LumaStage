<p align="center">
  <img src="https://github.com/Lendic42/LumaStage/releases/download/v0.1.0/LumaStage-icon.png" alt="LumaStage" width="128" height="128">
</p>

<h1 align="center">LumaStage</h1>

<p align="center">
  <strong>Отворени VTuber студио</strong><br>
  Десктоп за Windows / macOS + трекер на iPhone-у са Face ID
</p>

<p align="center">
  <a href="#-преузимање"><img src="https://img.shields.io/badge/download-v0.1.0-7c5cff?style=for-the-badge" alt="Download"></a>
  <a href="https://github.com/Lendic42/LumaStage/releases/latest"><img src="https://img.shields.io/github/v/release/Lendic42/LumaStage?style=for-the-badge&color=22c55e" alt="Release"></a>
  <a href="#-лиценца"><img src="https://img.shields.io/badge/license-GPL--3.0-blue?style=for-the-badge" alt="License"></a>
</p>

<p align="center">
  <code>Electron</code> · <code>React</code> · <code>SwiftUI</code> · <code>ARKit</code> · <code>GPL-3.0</code>
</p>

<p align="center">
  <a href="README.md">🇷🇺 Русский</a> ·
  <a href="README.en.md">🇬🇧 English</a> ·
  <a href="README.ja.md">🇯🇵 日本語</a> ·
  <a href="README.zh.md">🇨🇳 中文</a> ·
  <a href="README.ar.md">🇸🇦 العربية</a> ·
  🇷🇸 <b>Српски</b>
</p>

---

## ✨ Шта је ово

LumaStage ставља **Live2D моделе** на сцену (Cubism 3/4/5 и фасцикле из VTube Studio) и прати лице са **iPhone-а** преко локалне мреже.

- 🚫 без налога  
- ☁️ без облака  
- 💳 без претплате  
- 🏠 праћење остаје на твојој LAN мрежи  

---

## 🧩 Од чега се састоји

| | Део | Шта ради |
| :---: | --- | --- |
| 🖥️ | **Desktop** | Рендер модела, мапирање, сцене, хоткејеви, OBS оверлеј |
| 📱 | **Tracker** | TrueDepth + ARKit на Face ID iPhone-у, мала кашњења, LAN |
| 📡 | **Protocol** | Отворени TCP / Bonjour — `_lumastage._tcp`, порт `39510` |
| 🔌 | **VTS API** | VTube Studio Plugin API — `ws://127.0.0.1:8001` |

> ⚠️ Власнички **Live2D Cubism Core** није у репозиторијуму.  
> Инсталирај из апликације (званични Live2D CDN) или из Cubism SDK for Web.  
> Детаљи → [docs/compatibility.md](docs/compatibility.md)

---

## 📦 Преузимање

Готови билдови → **[Releases](https://github.com/Lendic42/LumaStage/releases/latest)**

| 📁 Фајл | 🖥️ Платформа |
| --- | --- |
| `LumaStage-macOS-0.1.0.dmg` | 🍎 macOS · инсталер |
| `LumaStage-macOS-0.1.0.zip` | 🍎 macOS · portable |
| `LumaStage-Windows-0.1.0-Setup.exe` | 🪟 Windows · инсталер |
| `LumaStage-Windows-0.1.0-Portable.exe` | 🪟 Windows · portable |
| `LumaStage-Tracker-0.1.0-unsigned.ipa` | 📱 iPhone · потписујеш сам |
| `LumaStage-0.1.0-source.zip` | 🧬 изворни код релиза |

### 📱 iPhone (Tracker)

IPA **није потписан**. Инсталирај преко Feather / AltStore / Sideloadly / TrollStore — својим сертификатом.

1. ⬇️ Преузми `LumaStage-Tracker-0.1.0-unsigned.ipa` из релиза  
2. ✍️ Потпиши и инсталирај на iPhone са Face ID  
3. 🖥️ Покрени Desktop и упари се **6-цифреним кодом**  
4. 📶 Оба уређаја држи на истој Wi‑Fi мрежи  

> 🔑 Прва веза: код на десктопу → потврда на iPhone-у.  
> После тога се чува локални токен уређаја.

### 🖥️ Desktop

1. ⬇️ Инсталирај macOS / Windows билд из релиза  
2. 📥 При првом увозу модела — преузми Cubism Core (потребна Live2D лиценца)  
3. 📂 Увези фасциклу са `*.model3.json` (опционо `*.vtube.json` из VTS)  
4. 📱 Повежи Tracker **или** ради у неутралној пози без iPhone-а  

---

## ✅ Шта већ постоји

| | Функција |
| :---: | --- |
| 🎭 | Увоз Cubism 3/4/5 и VTube Studio метаподатака (мапирања, expressions, motions, hotkeys) |
| 🎚️ | Калибрација и ублажавање праћења, живи едитор face → Live2D |
| 🎬 | Сцене: позадина, трансформација модела, PNG / JPG / GIF ставке, pin на ArtMesh |
| 📹 | Прозирни always-on-top оверлеј за OBS снимање |
| 🧩 | Локални VTS Plugin API (модели, hotkeys, items, physics, post-processing…) |
| 🔒 | Без облака: паровање само преко LAN-а, токени само на уређајима |

📖 Пуна API матрица → [docs/compatibility.md](docs/compatibility.md)  
🏗️ Архитектура → [docs/architecture.md](docs/architecture.md)

---

## 🛠️ Развој

Потребан је **Node.js 22+**.

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
packages/protocol      # 📡 протокол праћења
packages/vts-api       # 🔌 компатибилност VTS Plugin API
packages/scene-core    # 🎬 сцене
packages/tracking-core
packages/model-compat
docs/                  # 📖 docs
```

iOS пројекат: `apps/ios`. IPA је најлакше градити на Mac-у са Xcode-ом.

---

## 📄 Лиценца

Оригинални извор LumaStage је **GPL-3.0-only**.

Live2D Cubism Core, модели и туђи ассети имају своје лиценце.  
Види `THIRD_PARTY_NOTICES.md` и [docs/compatibility.md](docs/compatibility.md).

---

## ⭐ Star History

[![Star History Chart](./star-history.svg)](https://www.star-history.com/#LumaStage&Date)

<p align="center">
  Made with 💜 for VTubers · <a href="https://github.com/Lendic42/LumaStage/releases/latest">Download v0.1.0</a>
</p>
