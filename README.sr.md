**Languages:** [Русский](README.md) · [English](README.en.md) · [日本語](README.ja.md) · [中文](README.zh.md) · [العربية](README.ar.md) · **Српски**

# LumaStage

**Отворени VTuber студио: десктоп за Windows/macOS + трекер на iPhone-у са Face ID.**

`Electron` · `React` · `SwiftUI` · `ARKit` · `GPL-3.0`

LumaStage ставља Live2D моделе на сцену (Cubism 3/4/5 и фасцикле из VTube Studio) и прати лице са iPhone-а преко локалне мреже — без налога, облака и претплате. Праћење остаје на твојој LAN мрежи.

| Део | Шта ради |
| --- | --- |
| **Desktop** | Рендер модела, мапирање параметара, сцене, хоткејеви, OBS оверлеј |
| **Tracker** | TrueDepth + ARKit на Face ID iPhone-у, мала кашњења, локална мрежа |
| **Protocol** | Отворени TCP/Bonjour протокол (`_lumastage._tcp`, порт `39510`) |
| **VTS API** | Компатибилност са VTube Studio Plugin API на `ws://127.0.0.1:8001` |

> Власнички Live2D Cubism Core није у репозиторијуму. Можеш га инсталирати из апликације (званични Live2D CDN) или из Cubism SDK for Web. Детаљи: [docs/compatibility.md](docs/compatibility.md).

## Преузимање

Готови билдови су у [Releases](https://github.com/Lendic42/LumaStage/releases/latest).

| Фајл | Платформа |
| --- | --- |
| `LumaStage-macOS-0.1.0.dmg` | macOS (инсталер) |
| `LumaStage-macOS-0.1.0.zip` | macOS (portable) |
| `LumaStage-Windows-0.1.0-Setup.exe` | Windows (инсталер) |
| `LumaStage-Windows-0.1.0-Portable.exe` | Windows (portable) |
| `LumaStage-Tracker-0.1.0-unsigned.ipa` | iPhone (потписујеш сам) |
| `LumaStage-0.1.0-source.zip` | изворни код релиза |

### iPhone (Tracker)

IPA **није потписан**. Инсталирај преко Feather, AltStore, Sideloadly или TrollStore — својим сертификатом / уређајем.

1. Преузми `LumaStage-Tracker-0.1.0-unsigned.ipa` из релиза.
2. Потпиши и инсталирај на iPhone са Face ID.
3. Покрени Desktop и упари се шестоцифреним кодом са екрана.
4. Оба уређаја држи на истој Wi‑Fi мрежи.

Прва веза: код на десктопу → потврда на iPhone-у. После тога се чува локални токен уређаја.

### Desktop

1. Инсталирај macOS или Windows билд из релиза.
2. При првом увозу Live2D модела апликација нуди преузимање Cubism Core (потребна сагласност са Live2D лиценцом).
3. Увези фасциклу са `*.model3.json` (опционо `*.vtube.json` из VTube Studio).
4. Повежи Tracker или ради у неутралној пози без iPhone-а.

## Шта већ постоји

- Увоз Cubism 3/4/5 и VTube Studio метаподатака (мапирања, expressions, motions, hotkeys)
- Калибрација и ублажавање праћења, живи едитор face → Live2D
- Сцене: позадина, трансформација модела, PNG/JPG/GIF ставке, pin на ArtMesh
- Прозирни always-on-top оверлеј за OBS снимање
- Локални VTS Plugin API (модели, hotkeys, items, physics, post-processing итд.)
- Без облака: паровање само преко LAN-а, токени само на уређајима

Пуна API матрица и ограничења: [docs/compatibility.md](docs/compatibility.md). Архитектура: [docs/architecture.md](docs/architecture.md).

## Развој

Потребан је Node.js 22+.

```bash
npm install
npm run dev          # desktop
npm test
npm run package:mac  # dmg / zip
npm run package:win  # setup / portable
```

Структура:

```text
apps/desktop         Electron + React
apps/ios             SwiftUI + ARKit tracker
packages/protocol    протокол праћења
packages/vts-api     компатибилност VTS Plugin API
packages/scene-core  сцене
packages/tracking-core
packages/model-compat
docs/
```

iOS пројекат: `apps/ios`. IPA је најлакше градити на Mac-у са Xcode-ом.

## Лиценца

Оригинални извор LumaStage је **GPL-3.0-only**. Live2D Cubism Core, модели и туђи ассети имају своје лиценце — види `THIRD_PARTY_NOTICES.md` и [docs/compatibility.md](docs/compatibility.md).
