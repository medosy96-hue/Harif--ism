# حرف اسم 🎮

لعبة جماعية أونلاين (حتى 20 لاعبًا) — Next.js + Upstash Redis، جاهزة للنشر على Vercel.

## التشغيل محليًا

```bash
npm install
cp .env.example .env.local   # ثم عبّي القيم من Upstash (راجع الخطوات تحت)
npm run dev
```

افتح http://localhost:3000

## خطوات النشر على GitHub + Vercel (خطوة بخطوة)

### 1) ارفع المشروع على GitHub
```bash
git init
git add .
git commit -m "أول نسخة من لعبة حرف اسم"
git branch -M main
git remote add origin https://github.com/USERNAME/harf-ism.git
git push -u origin main
```
(بدّل `USERNAME` باسم حسابك، وأنشئ الريبو فارغ من GitHub قبل هالخطوة)

### 2) استورد المشروع بـ Vercel
- روح لـ https://vercel.com → **Add New → Project**
- اختر ريبو `harf-ism` من GitHub → **Import**
- خلي كل الإعدادات الافتراضية (Next.js بينكشف تلقائيًا) → **Deploy**
- أول نشر رح يفشل أو يشتغل بدون تخزين — طبيعي، لسا ما ضفنا قاعدة البيانات (الخطوة الجاية)

### 3) ضيف قاعدة بيانات Redis (مجانية)
- بمشروعك على Vercel، روح لتبويب **Storage**
- دوس **Create Database** → اختار **Upstash** (Redis)
- اختار الخطة المجانية (Free) → **Create**
- Vercel رح يربط قاعدة البيانات بمشروعك تلقائيًا ويضيف متغيرات البيئة (`KV_REST_API_URL` و `KV_REST_API_TOKEN`) بدون ما تحتاج تنسخ أي شي يدويًا

### 4) أعد النشر
- من تبويب **Deployments** بمشروعك → دوس على آخر نشر → **Redeploy**
- (هيك لأنو متغيرات البيئة الجديدة لازم نشر جديد لتنفعّل)

### 5) جرّب الموقع
- افتح الرابط يلي عطاك ياه Vercel (مثال: `harf-ism.vercel.app`)
- جرب "إنشاء لعبة" — المفروض يشتغل هلق فعليًا لأنو التخزين حقيقي

### النشر من طرفك (بديل لـ GitHub، متل ما اعتدت مع Jeem Jawab)
```bash
npm install -g vercel   # إذا ما كان مثبت
vercel --prod --force
```
بس أول مرة لازم تضيف قاعدة الـ Redis من خطوة (3) أول، وتسحب متغيرات البيئة محليًا إذا بدك تجرب محليًا:
```bash
vercel env pull .env.local
```

## بنية المشروع

```
app/
  page.js          # كل واجهة اللعبة (React، client component)
  layout.js         # القالب العام + الخطوط
  globals.css       # التصميم (ألوان العلم السوري، خطوط Cairo/Tajawal)
  api/game/route.js # كل منطق اللعبة على الخادم (إنشاء غرفة، انضمام، تسجيل نقاط...)
lib/
  redis.js          # الاتصال بقاعدة البيانات (Upstash Redis)
  constants.js       # الحروف العربية وتعريف الفئات الخمس
  scoring.js         # منطق احتساب صحة الكلمات والنقاط
```

## ملاحظات
- الغرف بتُحذف تلقائيًا بعد 6 ساعات من إنشائها (ما في داعي لتنضيف يدوي)
- التخزين مجاني ضمن حدود Upstash Free tier (كافي جدًا للاستخدام الشخصي وبين الأصدقاء)
- إذا حبيت تزيد مدة بقاء الغرف، عدّل `ROOM_TTL_SECONDS` بملف `lib/constants.js`
