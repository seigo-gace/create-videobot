#!/usr/bin/env python3
"""Non-destructive, strict overlay on the running CreateVdobot source snapshot.

Input stage is created by the separately admitted Gserver Host three-way
preflight. Never writes to the live container, its database or mounted secrets.
"""
from pathlib import Path
import re
import sys

if len(sys.argv) != 2:
    raise SystemExit(10)
stage = Path(sys.argv[1]).resolve(strict=True)
if not (stage / "live/src/telegram/paidListingPublisher.mjs").is_file():
    raise SystemExit(11)

def once(text, old, new, code):
    if text.count(old) != 1:
        raise RuntimeError(f"overlay anchor {code} missing or duplicated")
    return text.replace(old, new, 1)

def write(name, text):
    target = stage / "merged" / name
    target.parent.mkdir(parents=True, exist_ok=True)
    if "<<<<<<<" in text or ">>>>>>>" in text:
        raise RuntimeError("unresolved merge conflict: " + name)
    target.write_text(text, encoding="utf-8")

def live(name):
    return (stage / "live" / name).read_text(encoding="utf-8")

p = "src/telegram/paidListingPublisher.mjs"
s = live(p)
s = once(s, "  telegramApi\n} = {}) {",
    "  telegramApi,\n  saleMode='paid_media'\n} = {}) {", "publish-params")
s = once(s, "  const base={chatId:topic.chatId,messageThreadId:topic.threadId};",
    "  if(!['paid_media','invoice'].includes(saleMode)) throw Error('VIDEO_SALE_MODE_UNVERIFIED');\n"
    "  const base={chatId:topic.chatId,messageThreadId:topic.threadId};", "publish-mode")
s = once(s, "const paid=buildPaidMediaRequest({",
    "const paid=saleMode==='paid_media'?buildPaidMediaRequest({", "publish-paid-start")
s = once(s, "priceStars:listing.priceStars,caption,payload:key });",
    "priceStars:listing.priceStars,caption,payload:key }):null;", "publish-paid-end")
s = once(s,
    "const claim=await store.claim({key,listingId:listing.id,revision:listing.revision,topicId:topic.id});",
    "const claim=await store.claim({key,listingId:listing.id,revision:listing.revision,topicId:topic.id,saleMode});",
    "publish-claim")
invoice_case = """    if(saleMode==='invoice') {
      const preview=(await store.read(key))?.freeMessageIds;
      const sampleMessageId=preview?.[1];
      if(!Number.isSafeInteger(sampleMessageId)||sampleMessageId<=0)
        throw new Error('VIDEO_INVOICE_SAMPLE_RECEIPT_MISSING');
      const callback='vid:buy:'+listing.id+':'+listing.revision;
      if(Buffer.byteLength(callback,'utf8')>64)
        throw new Error('VIDEO_INVOICE_CALLBACK_TOO_LONG');
      const attached=await telegramApi('editMessageReplyMarkup',{
        chat_id:topic.chatId,message_id:sampleMessageId,
        reply_markup:{inline_keyboard:[[{text:'⭐ '+listing.priceStars+'で購入',callback_data:callback}]]}
      });
      if(attached!==true && attached?.alreadyCurrent!==true &&
         attached?.message_id!==sampleMessageId)
        throw new Error('VIDEO_INVOICE_BUTTON_ACK_UNKNOWN');
      await store.recordPaid(key,sampleMessageId);
      return {posted:true,alreadySent:false,saleMode:'invoice',
        freeMessageIds:preview,paidMessageId:sampleMessageId};
    }
"""
s = once(s, "    const paidResult=await telegramApi('sendPaidMedia',paid);",
    invoice_case + "    const paidResult=await telegramApi('sendPaidMedia',paid);", "publish-invoice")
write(p, s)

p = "src/telegram/creatorWiring.mjs"
s = live(p)
s = once(s, "import {createPostgresPostingReceiptStore} from '../sales/pgPostingReceipts.mjs';",
    "import {createPostgresPostingReceiptStore} from '../sales/pgPostingReceipts.mjs';\n"
    "import {createPostgresVideoInvoiceStore} from '../sales/pgVideoInvoiceOrders.mjs';\n"
    "import {createVideoInvoiceSalesFlow} from './videoInvoiceSales.mjs';", "wiring-imports")
s = once(s, "  const receiptStore=createPostgresPostingReceiptStore(pool);",
    "  const receiptStore=createPostgresPostingReceiptStore(pool);\n"
    "  const videoInvoiceStore=createPostgresVideoInvoiceStore(pool);\n"
    "  const videoInvoiceSales=createVideoInvoiceSalesFlow({api:telegramApi,store:videoInvoiceStore});",
    "wiring-store")
match = re.search(r"getVerifiedVideoTopic:gateOwner\.getVerifiedVideoTopic,?", s)
if not match or len(re.findall(r"getVerifiedVideoTopic:gateOwner\.getVerifiedVideoTopic,?", s)) != 1:
    raise RuntimeError("overlay anchor wiring-publisher missing or ambiguous")
s = s[:match.start()] + (
    "getVerifiedVideoTopic:gateOwner.getVerifiedVideoTopic,\n"
    "    // Existing unverified Starlock posts require invoice until unpaid-viewer proof.\n"
    "    saleMode:process.env.VIDEO_SALE_MODE==='paid_media'?'paid_media':'invoice',"
) + s[match.end():]
s = once(s, "    stickerSalesPayments:stickerSales.payments,",
    "    stickerSalesPayments:stickerSales.payments,\n"
    "    videoInvoiceHandler:videoInvoiceSales.handle,", "wiring-handler")
s = once(s, "    listingStore,sessionStore,receiptStore,",
    "    listingStore,sessionStore,receiptStore,videoInvoiceStore,videoInvoiceSales,",
    "wiring-return")
write(p, s)

p = "src/runtime/creatorMigrate.mjs"
s = live(p)
m = re.search(r"(?m)^(\s*)'021_sticker_refunds\.sql'(,?)$", s)
if not m or "022_video_invoice_fallback.sql" in s:
    raise RuntimeError("overlay anchor migration-022 invalid")
replacement = m.group(1) + "'021_sticker_refunds.sql',\n" + m.group(1) + "'022_video_invoice_fallback.sql'" + m.group(2)
s = s[:m.start()] + replacement + s[m.end():]
write(p, s)

p = "src/runtime/creatorPollingMain.mjs"
s = live(p)
migration_source = live("src/runtime/creatorMigrate.mjs")
prior_count = len(re.findall(r"(?m)^\s*'\d{3}_[^']+\.sql'", migration_source))
guard = re.search(r"schema\.migrations\s*!==\s*([0-9]+)", s)
if not guard or prior_count < 1 or int(guard.group(1)) != prior_count:
    raise RuntimeError("overlay anchor poller-migration-count is not consistent with live schema")
s = s[:guard.start(1)] + str(prior_count + 1) + s[guard.end(1):]
write(p, s)

for name in (
    "src/telegram/creatorBot.mjs",
    "src/sales/pgPostingReceipts.mjs",
    "src/sales/pgStarsLedger.mjs",
    "src/telegram/videoInvoiceSales.mjs",
    "src/sales/pgVideoInvoiceOrders.mjs",
    "sql/022_video_invoice_fallback.sql",
):
    target = stage / "merged" / name
    if not target.is_file() or "<<<<<<<" in target.read_text(encoding="utf-8"):
        raise RuntimeError("stage file absent/conflicted: " + name)
print("VIDEO_DUALMODE_LOSSLESS_SOURCE_OVERLAY_STAGED=PASS")
