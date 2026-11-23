#!/usr/bin/env python3
"""Independent Telegram official sendPaidMedia fresh-file comparison probe.

No imports from CreateVdobot and no file_id reuse. Defaults to preflight.
This DOES NOT install, restart, logOut, or migrate a Bot API server.
"""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
from urllib.parse import urlsplit

MAX_BYTES = 2_000_000_000

def fail(code):
    print(json.dumps({"status": "BLOCKED", "reason": code}, ensure_ascii=False))
    raise SystemExit(2)

def env_int(name, positive=True):
    try:
        value = int(os.environ[name])
    except (KeyError, ValueError):
        fail(name + "_MISSING_OR_INVALID")
    if positive and value <= 0:
        fail(name + "_MISSING_OR_INVALID")
    return value

def main():
    parser = argparse.ArgumentParser(description="Independent official Telegram paid media fresh upload")
    parser.add_argument("--send", action="store_true", help="Perform one new real Telegram post")
    args = parser.parse_args()
    path = Path(os.environ.get("STARLOCK_TEST_VIDEO_PATH", ""))
    if not path.is_file() or not path.resolve().is_file():
        fail("ORIGINAL_VIDEO_NOT_FOUND")
    size = path.stat().st_size
    if not (0 < size <= MAX_BYTES):
        fail("ORIGINAL_VIDEO_OUTSIDE_LOCAL_API_LIMIT")
    if path.suffix.lower() != ".mp4":
        fail("EXPECTED_MP4_SOURCE")
    chat_id = env_int("STARLOCK_TEST_CHAT_ID", positive=False)
    if chat_id >= 0:
        fail("EXPECTED_SUPERGROUP_OR_CHANNEL")
    thread_id = env_int("STARLOCK_TEST_THREAD_ID")
    price = env_int("STARLOCK_TEST_PRICE")
    if price > 25000:
        fail("STAR_PRICE_EXCEEDS_LIMIT")
    base = os.environ.get("STARLOCK_LOCAL_BOT_API_BASE", "")
    url = urlsplit(base)
    if (url.scheme != "http" or url.hostname not in ("localhost", "127.0.0.1", "telegram-bot-api")
            or url.username or url.password or url.query or url.fragment or (url.path not in ("", "/"))):
        fail("LOCAL_BOT_API_ENDPOINT_NOT_VERIFIED")
    token = os.environ.get("STARLOCK_TEST_BOT_TOKEN", "")
    if not re.fullmatch(r"[0-9]+:[A-Za-z0-9_-]{30,}", token):
        fail("BOT_TOKEN_NOT_AVAILABLE")
    # A test offer still creates a real Telegram paid post; keep the target explicit.
    if os.environ.get("STARLOCK_TEST_RIGHTS_CONFIRMED") != "YES":
        fail("VIDEO_RIGHTS_NOT_CONFIRMED")
    if os.environ.get("STARLOCK_TEST_TARGET_CONFIRMED") != "YES":
        fail("TEST_TOPIC_NOT_CONFIRMED")
    print(json.dumps({"status": "PREFLIGHT_OK", "bytes": size, "chat_id": chat_id,
                      "thread_id": thread_id, "stars": price, "transport": "fresh_multipart_local_bot_api",
                      "send_requested": args.send}, ensure_ascii=False), flush=True)
    if not args.send:
        return
    if os.environ.get("STARLOCK_TEST_CONFIRM") != "FRESH_UPLOAD_ONLY":
        fail("LIVE_SEND_NOT_CONFIRMED")
    media = json.dumps([{"type": "video", "media": "attach://paid_video"}], separators=(",", ":"))
    endpoint = base.rstrip("/") + "/bot" + token + "/sendPaidMedia"
    # Keep bot token out of argv, stdout, stderr and persisted result.
    config = 'url = ' + json.dumps(endpoint) + '\n'
    with tempfile.TemporaryDirectory(prefix="starlock-probe-") as temp:
        response_path = Path(temp) / "response.json"
        command = ["curl", "--silent", "--show-error", "--max-time", "1800",
                   "--config", "-", "--request", "POST",
                   "--form-string", "chat_id=" + str(chat_id),
                   "--form-string", "message_thread_id=" + str(thread_id),
                   "--form-string", "star_count=" + str(price),
                   "--form-string", "media=" + media,
                   "--form", "paid_video=@" + str(path.resolve()) + ";type=video/mp4",
                   "--output", str(response_path), "--write-out", "%{http_code}"]
        try:
            proc = subprocess.run(command, input=config, text=True, capture_output=True, timeout=1850)
        except (OSError, subprocess.TimeoutExpired):
            fail("SEND_TRANSPORT_UNKNOWN_CHECK_TELEGRAM_BEFORE_RETRY")
        if proc.returncode != 0:
            fail("SEND_RESULT_UNKNOWN_DO_NOT_AUTO_RETRY")
        try:
            reply = json.loads(response_path.read_text())
        except (OSError, ValueError):
            fail("SEND_RESULT_UNKNOWN_UNREADABLE_RESPONSE")
        if proc.stdout.strip() != "200" or reply.get("ok") is not True:
            fail("TELEGRAM_SEND_REJECTED_CHECK_PRIVATE_LOG")
        message = reply.get("result") or {}
        paid = message.get("paid_media") or {}
        entry = paid.get("paid_media") or []
        verified = (message.get("chat", {}).get("id") == chat_id
                    and paid.get("star_count") == price
                    and len(entry) == 1
                    and entry[0].get("type") == "video")
        # API acceptance is not the same as viewer-side purchase protection.
        print(json.dumps({"status": "API_ACK_VERIFIED" if verified else "API_ACK_UNEXPECTED",
                          "message_id": message.get("message_id"), "chat_id": chat_id,
                          "thread_id": message.get("message_thread_id"),
                          "paid_media_type": entry[0].get("type") if entry else None,
                          "star_count": paid.get("star_count"),
                          "viewer_lock_verified": False}, ensure_ascii=False))
        if not verified:
            raise SystemExit(3)

if __name__ == "__main__":
    main()
