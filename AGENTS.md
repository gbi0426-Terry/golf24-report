# AGENTS.md — Golf24 高爾夫學院 教練預約平台

> 這份檔案是給 AI coding agent（Codex / Claude Code 等）看的專案常駐指示。
> 開始寫任何程式前，先讀這份與 `docs/spec.md`。全程用**繁體中文**與使用者溝通與寫註解。

## 這個專案是什麼

把一間室內高爾夫球室（Golf24）升級成「教練預約 + 會員經營」平台。
學員從球室 QR Code 進入 LINE LIFF 預約頁，用 LINE 身分預約教練；系統建立預約後，透過 LINE Messaging API 個別通知指定教練、老闆與管理者，再由店家確認時間與訂金付款。

**商業背景與完整規格**：見 `docs/spec.md`。
**設計語言與現有成果**：`index.html`（學員報名落地頁，Phase 0，已上線）、`report.html`（商業模式與系統架構提案）。
→ 新系統的視覺請沿用 `index.html` 的配色與元件風格（見下方「設計 tokens」）。

## 目前狀態（你接手的起點）

- **Phase 0 已完成**：`index.html` 是一頁式靜態落地頁，掛在 GitHub Pages。
  表單目前送到 Formspree／mailto，尚無後端、無資料庫。
- **你的任務 = Phase 1**：採用「方案 3：LINE LIFF 預約系統」，把靜態頁升級成真的能運作的預約系統（見「Phase 1 範圍」）。

## 已確認產品決策

- QR Code 不直接導到一般網頁表單，也不只開 LINE 聊天室；正式方案是導到 **LINE LIFF 預約頁**。
- 學員使用 LINE Login / LIFF 身分進入系統，系統保存 `line_user_id` 作為後續通知與會員識別基礎。
- 通知採 **A 方案：個人 LINE push**，不採群組通知。預約成立後分別通知指定教練、老闆、管理者。
- 若學員未指定教練，先通知老闆與管理者；店家後台分配教練後，再通知該教練。
- 現有 `index.html` 保留作為 Phase 0 展示頁與視覺/文案參考；正式預約功能要移植到 Next.js + LIFF。

## 技術選型（除非使用者另有指示，一律照這個做）

| 層 | 技術 | 原因 |
|----|------|------|
| 前端 + 後端 | **Next.js（App Router, TypeScript）** | 一套搞定、單人可維護 |
| 資料庫 / Auth | **Supabase（Postgres）** | 免運維、內建 Auth、對應 spec 的 6 張表 |
| 金流 | **綠界 ECPay** | 台灣訂金 / 發票最成熟 |
| LINE 入口 | **LINE LIFF + LINE Login** | QR Code 掃描後在 LINE 內完成登入與預約 |
| 通知 | **LINE Messaging API** | 預約後個別通知教練、老闆、管理者 |
| 樣式 | **Tailwind CSS**，沿用 `index.html` 的色票 | 快速、與現有設計一致 |
| 部署 | Vercel（app）+ Supabase | 初期近乎免費 |

## Phase 1 範圍（要做的）

1. 把 `index.html` 的落地頁改寫成 Next.js + LIFF 預約頁，保留設計。
2. 串 LINE Login / LIFF，取得並保存學員 `line_user_id`、顯示名稱、頭像。
3. 報名表單寫入 Supabase `bookings`（同時建立 / 關聯 `members`）。
4. 後台（店家端）：查看 / 確認預約、分配教練、標記場地狀態、改期、退款註記。
5. 送出報名後觸發 LINE 個人通知：指定教練 + 老闆 + 管理者；未指定教練時先通知老闆 + 管理者。
6. 教練與管理者 LINE 綁定：先加官方 LINE，再用綁定頁保存各自 `line_user_id`。
7. 綠界訂金：產生付款連結 / 導頁，回呼寫入 `payments`。
8. 課程、教練資料用資料表驅動（`courses`、`coaches`），不要寫死在畫面。

## 明確「先不要做」（避免 Phase 1 膨脹）

- ❌ 分潤自動結算（初期教練 3–5 人，用 Excel 對帳即可）
- ❌ 一般帳密登入 / 完整會員中心（Phase 1 僅用 LINE LIFF 身分 + 手機認人）
- ❌ LINE 群組通知作為主要通知模式（多教練場景改用個人 push）
- ❌ 堂數 / 套票管理
- ❌ AI 課後報告、揮桿影片分析
- ❌ 與 Golf24 門禁 / 場地系統自動串接（Phase 1 維持「人工確認場地」）

> 如果覺得某項非做不可，先在 PR / 對話中提出理由，不要自己擴張範圍。

## 已知最大風險（設計時要處理）

**雙重預約（double booking）**：Phase 1 場地時間是人工確認。
→ 學員選的是「日期 + 時段（上午/下午/晚上）」而非精確時段；付的是「預約金」，
   由店家在後台喬到確切時間、LINE 確認後才算 confirmed。狀態機見 spec。

## 設計 tokens（沿用 index.html）

```
--green-950:#071b14  --green-900:#0b241a  --green-800:#103727  --green-700:#18543c
--green-100:#eaf5ef  --gold:#c7a35b  --gold-2:#f3dfab
--ink:#15221c  --muted:#64736b  --line:#dce6df  --bg:#f6f8f5
字型：-apple-system, "Noto Sans TC", "PingFang TC", "Microsoft JhengHei"
LINE 綠：#06c755
```

## 慣例

- 語言：介面、文案、commit message、註解都用**繁體中文**。
- 金額單位一律 TWD（整數，不含小數）。
- 秘密金鑰（Supabase service key、ECPay、LINE channel secret / access token）放 `.env.local`，**永遠不要 commit**；提供 `.env.example`。
- 每完成一個可運行的小步驟就 commit，訊息說明「做了什麼、為什麼」。
- 動任何金流 / 發訊息 / 刪資料的程式前，先確認流程再寫。

## 怎麼跑（實作後請更新這段）

```bash
# TODO: 由 agent 建立 Next.js 專案後補上
# npm install
# cp .env.example .env.local  # 填入 Supabase / ECPay / LINE 金鑰
# npm run dev
```

## 交付順序建議

1. 讀 `docs/spec.md` → 確認資料表與流程理解無誤（可先跟使用者對規格）。
2. `supabase/schema.sql`：建立會員、教練、管理者、課程、預約、付款、通知紀錄等資料表 + enum 狀態。
3. Next.js scaffold + LIFF 初始化 + 落地頁移植 + 報名寫入 DB。
4. 教練 / 管理者 LINE 綁定頁。
5. 店家後台（確認 / 分配教練 / 改期）。
6. LINE 個人通知 → 綠界訂金。
