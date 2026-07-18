**Languages:** [Русский](README.md) · [English](README.en.md) · [日本語](README.ja.md) · [中文](README.zh.md) · **العربية** · [Српски](README.sr.md)

<div dir="rtl" lang="ar">

# LumaStage

**استوديو VTuber مفتوح المصدر: سطح مكتب لـ Windows/macOS + متتبع iPhone بـ Face ID.**

`Electron` · `React` · `SwiftUI` · `ARKit` · `GPL-3.0`

يضع LumaStage نماذج Live2D على المسرح (Cubism 3/4/5 ومجلدات VTube Studio) ويتتبع الوجه من iPhone عبر الشبكة المحلية — بلا حساب أو سحابة أو اشتراك. بيانات التتبع تبقى على شبكتك المنزلية.

| الجزء | الوظيفة |
| --- | --- |
| **Desktop** | عرض النموذج، ربط المعاملات، المشاهد، الاختصارات، طبقة OBS |
| **Tracker** | TrueDepth + ARKit على iPhone بـ Face ID، تأخير منخفض، شبكة محلية |
| **Protocol** | بروتوكول TCP/Bonjour مفتوح (`_lumastage._tcp`، المنفذ `39510`) |
| **VTS API** | توافق Plugin API لـ VTube Studio على `ws://127.0.0.1:8001` |

> نواة Live2D Cubism Core الاحتكارية غير مضمّنة في المستودع. يمكن تثبيتها من التطبيق (CDN الرسمي لـ Live2D) أو من Cubism SDK for Web. التفاصيل: [docs/compatibility.md](docs/compatibility.md).

## التحميل

البناءات الجاهزة في [Releases](https://github.com/Lendic42/LumaStage/releases/latest).

| الملف | المنصة |
| --- | --- |
| `LumaStage-macOS-0.1.0.dmg` | macOS (مثبّت) |
| `LumaStage-macOS-0.1.0.zip` | macOS (محمول) |
| `LumaStage-Windows-0.1.0-Setup.exe` | Windows (مثبّت) |
| `LumaStage-Windows-0.1.0-Portable.exe` | Windows (محمول) |
| `LumaStage-Tracker-0.1.0-unsigned.ipa` | iPhone (توقيعك أنت) |
| `LumaStage-0.1.0-source.zip` | مصادر الإصدار |

### iPhone (Tracker)

ملف IPA **غير موقَّع**. ثبّته عبر Feather أو AltStore أو Sideloadly أو TrollStore بشهادتك / جهازك.

1. نزّل `LumaStage-Tracker-0.1.0-unsigned.ipa` من الإصدار.
2. وقّعه وثبّته على iPhone بـ Face ID.
3. شغّل Desktop واركّب الاقتران برمز من ستة أرقام على الشاشة.
4. أبقِ الجهازين على نفس شبكة Wi‑Fi.

أول اتصال: الرمز على سطح المكتب ← التأكيد على iPhone. بعدها يُحفظ رمز جهاز محلي.

### Desktop

1. ثبّت بناء macOS أو Windows من الإصدار.
2. عند أول استيراد لنموذج Live2D يقترح التطبيق تنزيل Cubism Core (يتطلب قبول رخصة Live2D).
3. استورد مجلدًا يحتوي `*.model3.json` (يمكن مع `*.vtube.json` من VTube Studio).
4. وصّل Tracker أو اعمل بوضعية محايدة دون iPhone.

## ما المتوفر

- استيراد Cubism 3/4/5 وبيانات VTube Studio (الربط، التعبيرات، الحركات، الاختصارات)
- معايرة وتنعيم التتبع ومحرر حي لربط الوجه → Live2D
- مشاهد: خلفية، تحويل النموذج، عناصر PNG/JPG/GIF، تثبيت على ArtMesh
- طبقة شفافة دائمًا في الأعلى لالتقاط OBS
- VTS Plugin API محلي (نماذج، اختصارات، عناصر، فيزياء، معالجة لاحقة وغيرها)
- بلا سحابة: الاقتران عبر LAN فقط، والرموز على الأجهزة فقط

مصفوفة الـ API والحدود: [docs/compatibility.md](docs/compatibility.md). البنية: [docs/architecture.md](docs/architecture.md).

## التطوير

يتطلب Node.js 22+.

```bash
npm install
npm run dev          # desktop
npm test
npm run package:mac  # dmg / zip
npm run package:win  # setup / portable
```

الهيكل:

```text
apps/desktop         Electron + React
apps/ios             SwiftUI + ARKit tracker
packages/protocol    بروتوكول التتبع
packages/vts-api     توافق VTS Plugin API
packages/scene-core  المشاهد
packages/tracking-core
packages/model-compat
docs/
```

مشروع iOS: `apps/ios`. بناء IPA أسهل على Mac مع Xcode.

## الرخصة

مصدر LumaStage الأصلي مرخّص بـ **GPL-3.0-only**. Live2D Cubism Core والنماذج وأصول الطرف الثالث لها رخصها الخاصة — انظر `THIRD_PARTY_NOTICES.md` و [docs/compatibility.md](docs/compatibility.md).

</div>
