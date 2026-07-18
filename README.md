**Languages:** **Русский** · [English](README.en.md) · [日本語](README.ja.md) · [中文](README.zh.md) · [العربية](README.ar.md) · [Српски](README.sr.md)

# LumaStage

**Открытая VTuber-студия: десктоп для Windows/macOS + трекер на iPhone с Face ID.**

`Electron` · `React` · `SwiftUI` · `ARKit` · `GPL-3.0`

LumaStage собирает на сцене Live2D-модели (Cubism 3/4/5 и папки из VTube Studio), а мимику снимает iPhone по локальной сети — без аккаунта, облака и подписки. Треккинг остаётся у тебя дома.

| Часть | Что делает |
| --- | --- |
| **Desktop** | Рендер модели, маппинг параметров, сцены, хоткеи, оверлей под OBS |
| **Tracker** | TrueDepth + ARKit на Face ID iPhone, низкая задержка, локальная сеть |
| **Протокол** | Открытый TCP/Bonjour-протокол (`_lumastage._tcp`, порт `39510`) |
| **VTS API** | Совместимость с Plugin API VTube Studio на `ws://127.0.0.1:8001` |

> Проприетарный Live2D Cubism Core в репозиторий не входит. Его можно поставить из приложения (официальный CDN Live2D) или из SDK for Web. Подробности — [docs/compatibility.md](docs/compatibility.md).

## Скачать

Готовые сборки — в [Releases](https://github.com/Lendic42/LumaStage/releases/latest).

| Файл | Платформа |
| --- | --- |
| `LumaStage-macOS-0.1.0.dmg` | macOS (установщик) |
| `LumaStage-macOS-0.1.0.zip` | macOS (portable) |
| `LumaStage-Windows-0.1.0-Setup.exe` | Windows (установщик) |
| `LumaStage-Windows-0.1.0-Portable.exe` | Windows (portable) |
| `LumaStage-Tracker-0.1.0-unsigned.ipa` | iPhone (нужна своя подпись) |
| `LumaStage-0.1.0-source.zip` | исходники релиза |

### iPhone (Tracker)

IPA **не подписан**. Ставь через Feather, AltStore, Sideloadly или TrollStore — своим сертификатом / своим устройством.

1. Скачай `LumaStage-Tracker-0.1.0-unsigned.ipa` из релиза.
2. Подпиши и установи на iPhone с Face ID.
3. Запусти Desktop, открой пару по шестизначному коду с экрана.
4. Держи оба устройства в одной Wi‑Fi сети.

Первое подключение: код на десктопе → подтверждение на iPhone. После этого сохраняется локальный токен устройства.

### Desktop

1. Поставь macOS/Windows сборку из релиза.
2. При первом импорте Live2D-модели приложение предложит скачать Cubism Core (нужно согласие с лицензией Live2D).
3. Импортируй папку с `*.model3.json` (можно с `*.vtube.json` из VTube Studio).
4. Подключи Tracker или работай в нейтральной позе без iPhone.

## Что уже есть

- Импорт Cubism 3/4/5 и метаданных VTube Studio (маппинги, expressions, motions, hotkeys)
- Калибровка и сглаживание трекинга, живой редактор face → Live2D
- Сцены: фон, трансформ модели, PNG/JPG/GIF items, pin к ArtMesh
- Прозрачный always-on-top оверлей под захват в OBS
- Локальный VTS Plugin API (модели, hotkeys, items, physics, post-processing и т.д.)
- Без облака: pairing только по LAN, токены только на устройствах

Полная матрица API и ограничения — в [docs/compatibility.md](docs/compatibility.md). Архитектура — [docs/architecture.md](docs/architecture.md).

## Разработка

Нужен Node.js 22+.

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
packages/protocol    протокол трекинга
packages/vts-api     совместимость VTS Plugin API
packages/scene-core  сцены
packages/tracking-core
packages/model-compat
docs/
```

iOS-проект: `apps/ios`. Сборку IPA удобнее гонять на Mac с Xcode.

## Лицензия

Исходники LumaStage — **GPL-3.0-only**. Live2D Cubism Core, модели и чужие ассеты — по своим лицензиям, см. `THIRD_PARTY_NOTICES.md` и [docs/compatibility.md](docs/compatibility.md).
