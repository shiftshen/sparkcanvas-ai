#!/usr/bin/env python3
import argparse
import base64
import json
import mimetypes
import os
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any


def fail(message: str) -> None:
    print(message, file=sys.stderr)
    raise SystemExit(1)


def env_first(*names: str) -> str:
    for name in names:
        value = os.environ.get(name)
        if value:
            return value
    return ""


def local_auth_value(*names: str) -> str:
    candidates = [
        os.environ.get("SPARKCANVAS_AUTH_FILE", ""),
        "auth.json",
        "config/auth.json",
    ]
    for candidate in candidates:
        if not candidate:
            continue
        path = Path(candidate)
        if not path.exists():
            continue
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            continue
        for name in names:
            value = data.get(name)
            if isinstance(value, str) and value:
                return value
    return ""


def image_to_data_url(path: str) -> str:
    file_path = Path(path)
    if not file_path.exists():
        fail(f"Input image not found: {path}")
    mime = mimetypes.guess_type(file_path.name)[0] or "image/png"
    encoded = base64.b64encode(file_path.read_bytes()).decode("ascii")
    return f"data:{mime};base64,{encoded}"


def parse_sse_events(raw: str) -> list[Any]:
    events: list[Any] = []
    for block in raw.split("\n\n"):
        data_lines = [line[5:].strip() for line in block.splitlines() if line.startswith("data:")]
        if not data_lines:
            continue
        data = "\n".join(data_lines)
        if data == "[DONE]":
            continue
        try:
            events.append(json.loads(data))
        except json.JSONDecodeError:
            continue
    return events


def find_image_b64(value: Any) -> str | None:
    if isinstance(value, dict):
        if value.get("type") == "image_generation_call" and isinstance(value.get("result"), str):
            return value["result"]
        inline_data = value.get("inlineData") or value.get("inline_data")
        if isinstance(inline_data, dict) and isinstance(inline_data.get("data"), str):
            mime = str(inline_data.get("mimeType") or inline_data.get("mime_type") or "")
            if not mime or mime.startswith("image/"):
                return inline_data["data"]
        for item in value.values():
            found = find_image_b64(item)
            if found:
                return found
    if isinstance(value, list):
        for item in value:
            found = find_image_b64(item)
            if found:
                return found
    return None


def is_rate_limit_error(raw: str, parsed: Any) -> bool:
    text = raw
    if parsed is not None:
        text += "\n" + json.dumps(parsed, ensure_ascii=False)
    return "rate_limit_exceeded" in text or "Please try again in" in text


def retry_delay(raw: str) -> float:
    match = re.search(r"try again in\s+(\d+)ms", raw, re.I)
    if match:
        return max(0.5, int(match.group(1)) / 1000)
    return 1.0


def has_tools_empty_fallback(raw: str, parsed: Any) -> bool:
    text = raw
    if parsed is not None:
        text += "\n" + json.dumps(parsed, ensure_ascii=False)
    return '"tools":[]' in text.replace(" ", "") or "image_generation_call" not in text


def build_input(prompt: str, input_images: list[str]) -> Any:
    if not input_images:
        return prompt
    content: list[dict[str, str]] = [{"type": "input_text", "text": prompt}]
    for image_path in input_images:
        content.append({"type": "input_image", "image_url": image_to_data_url(image_path)})
    return [{"role": "user", "content": content}]


def input_variants(input_images: list[str]) -> list[list[str]]:
    if not input_images:
        return [[]]
    variants: list[list[str]] = []
    for count in range(len(input_images), 0, -1):
        variants.append(input_images[:count])
    return variants


def model_for_gemini(model: str) -> str:
    aliases = {
        "nano_banana_2": "gemini-3.1-flash-image-preview",
        "nano-banana-2": "gemini-3.1-flash-image-preview",
    }
    return aliases.get(model, model)


def model_for_responses(model: str) -> str:
    aliases = {
        "nano_banana_2": "gpt-5.4",
        "nano-banana-2": "gpt-5.4",
    }
    return aliases.get(model, model)


def is_gemini_image_model(model: str) -> bool:
    normalized = model.lower()
    return normalized.startswith("gemini-")


def is_openai_image_model(model: str) -> bool:
    normalized = model.lower()
    return (
        normalized.startswith("gpt-image-")
        or normalized.startswith("grok-imagine-image")
        or normalized.startswith("image2")
    )


def gemini_base_url(base_url: str) -> str:
    url = base_url.rstrip("/")
    if url.endswith("/v1"):
        return url[:-3]
    if url.endswith("/v1/"):
        return url[:-4]
    return url


def build_gemini_parts(prompt: str, input_images: list[str]) -> list[dict[str, Any]]:
    parts: list[dict[str, Any]] = [{"text": prompt}]
    for image_path in input_images:
        file_path = Path(image_path)
        if not file_path.exists():
            fail(f"Input image not found: {image_path}")
        mime = mimetypes.guess_type(file_path.name)[0] or "image/png"
        parts.append({
            "inlineData": {
                "mimeType": mime,
                "data": base64.b64encode(file_path.read_bytes()).decode("ascii"),
            }
        })
    return parts


def call_gemini_image(args: argparse.Namespace, base_url: str, api_key: str) -> int:
    model = model_for_gemini(args.model)
    url = f"{gemini_base_url(base_url)}/v1beta/models/{model}:generateContent"
    payload = {
        "contents": [{"role": "user", "parts": build_gemini_parts(args.prompt, args.input_image)}],
        "generationConfig": {
            "responseModalities": ["IMAGE"],
            "imageConfig": {
                "aspectRatio": args.aspect_ratio,
                "imageSize": args.image_size,
            },
        },
    }
    last_raw = ""
    for attempt in range(args.retries + 1):
        data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            url,
            data=data,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
                "User-Agent": "SparkCanvas/0.1 nano-banana-image",
                "version": "2026-05-20",
                "originator": "sparkcanvas-xmanx",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=180) as resp:
                raw = resp.read().decode("utf-8", errors="replace")
                status = resp.status
        except urllib.error.HTTPError as exc:
            body = exc.read().decode("utf-8", errors="replace")
            if attempt < args.retries and ("rate" in body.lower() or exc.code in {429, 500, 502, 503, 504}):
                time.sleep(retry_delay(body) + attempt * 0.5)
                continue
            fail(f"HTTP {exc.code}\n{body}")
        except Exception as exc:
            if attempt < args.retries:
                time.sleep(1.0 + attempt * 0.5)
                continue
            fail(f"Request failed: {exc}")
        if status < 200 or status >= 300:
            fail(f"Unexpected HTTP status: {status}\n{raw}")
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            fail(f"Response was not valid JSON:\n{raw[:4000]}")
        image_b64 = find_image_b64(parsed)
        if image_b64:
            out = Path(args.output)
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_bytes(base64.b64decode(image_b64))
            print(str(out))
            return 0
        last_raw = raw
        if attempt < args.retries:
            time.sleep(1.0 + attempt * 0.5)
            continue
        break
    fail("No base64 image found in Gemini response.\n" + last_raw[:4000])
    return 1


def image_generation_size(aspect_ratio: str) -> str:
    mapping = {
        "1:1": "1024x1024",
        "3:4": "1024x1365",
        "4:5": "1024x1280",
        "9:16": "1024x1792",
        "16:9": "1792x1024",
    }
    return mapping.get(aspect_ratio, "1024x1024")


def first_image_output(value: Any) -> tuple[str, str] | None:
    if isinstance(value, dict):
        for key in ("b64_json", "url"):
            item = value.get(key)
            if isinstance(item, str) and item:
                if item.startswith("http://") or item.startswith("https://"):
                    return ("url", item)
                return ("b64", item)
        for item in value.values():
            found = first_image_output(item)
            if found:
                return found
    if isinstance(value, list):
        for item in value:
            found = first_image_output(item)
            if found:
                return found
    return None


def write_image_output(output: tuple[str, str], output_path: str) -> None:
    kind, value = output
    out = Path(output_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    if kind == "url":
        req = urllib.request.Request(value, headers={"User-Agent": "SparkCanvas/0.1 image-download"})
        with urllib.request.urlopen(req, timeout=120) as resp:
            out.write_bytes(resp.read())
    else:
        out.write_bytes(base64.b64decode(value))


def call_openai_image_generation(args: argparse.Namespace, base_url: str, api_key: str) -> int:
    url = base_url.rstrip("/")
    if not url.endswith("/images/generations"):
        url = f"{url}/images/generations"
    prompt = args.prompt
    image_inputs = [image_to_data_url(image_path) for image_path in args.input_image]
    if image_inputs:
        prompt = "\n".join([args.prompt, "", "Use all attached reference images for brand identity, product shape, character consistency, color system, and composition constraints."])
    payload = {
        "model": args.model,
        "prompt": prompt,
        "n": 1,
        "size": image_generation_size(args.aspect_ratio),
    }
    if image_inputs:
        payload["image"] = image_inputs
    last_raw = ""
    for attempt in range(args.retries + 1):
        data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            url,
            data=data,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
                "User-Agent": "SparkCanvas/0.1 images-generations",
                "version": "2026-05-20",
                "originator": "sparkcanvas-xmanx",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=240) as resp:
                raw = resp.read().decode("utf-8", errors="replace")
                status = resp.status
        except urllib.error.HTTPError as exc:
            body = exc.read().decode("utf-8", errors="replace")
            if attempt < args.retries and ("rate" in body.lower() or exc.code in {429, 500, 502, 503, 504}):
                time.sleep(retry_delay(body) + attempt * 0.5)
                continue
            fail(f"HTTP {exc.code}\n{body}")
        except Exception as exc:
            if attempt < args.retries:
                time.sleep(1.0 + attempt * 0.5)
                continue
            fail(f"Request failed: {exc}")
        if status < 200 or status >= 300:
            fail(f"Unexpected HTTP status: {status}\n{raw}")
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            fail(f"Response was not valid JSON:\n{raw[:4000]}")
        output = first_image_output(parsed)
        if output:
            write_image_output(output, args.output)
            print(str(Path(args.output)))
            return 0
        last_raw = raw
        if attempt < args.retries:
            time.sleep(1.0 + attempt * 0.5)
            continue
        break
    fail("No image URL/base64 found in /images/generations response.\n" + last_raw[:4000])
    return 1


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate image through GPT + image_generation tool over /v1/responses.")
    parser.add_argument("--prompt", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--model", default=env_first("IMAGE_GEN_MODEL") or "gpt-5.4")
    parser.add_argument("--format", default="png", choices=["png", "jpeg", "webp"])
    parser.add_argument("--input-image", action="append", default=[])
    parser.add_argument("--instructions", default="You are a helpful image generation assistant. Return an image using the image_generation tool.")
    parser.add_argument("--aspect-ratio", default=env_first("IMAGE_GEN_ASPECT_RATIO") or "1:1")
    parser.add_argument("--image-size", default=env_first("IMAGE_GEN_IMAGE_SIZE") or "2K")
    parser.add_argument("--engine", default=env_first("IMAGE_GEN_ENGINE") or "auto", choices=["auto", "responses", "gemini", "images"])
    parser.add_argument("--stream", dest="stream", action="store_true")
    parser.add_argument("--no-stream", dest="stream", action="store_false")
    parser.set_defaults(stream=False)
    parser.add_argument("--retries", type=int, default=4)
    parser.add_argument("--session-id", default="")
    args = parser.parse_args()

    base_url = (
        env_first("IMAGE_GEN_BASE_URL", "YIJIARJ_BASE_URL", "OTCBOT_BASE_URL", "CPA_BASE_URL", "OPENAI_BASE_URL")
        or local_auth_value("IMAGE_GEN_BASE_URL", "YIJIARJ_BASE_URL", "OTCBOT_BASE_URL", "CPA_BASE_URL", "OPENAI_BASE_URL")
        or "https://api.yijiarj.cn/v1"
    )
    api_key = (
        env_first("IMAGE_GEN_KEY", "YIJIARJ_API_KEY", "OTCBOT_API_KEY", "CPA_API_KEY", "OPENAI_API_KEY")
        or local_auth_value("IMAGE_GEN_KEY", "YIJIARJ_API_KEY", "OTCBOT_API_KEY", "CPA_API_KEY", "OPENAI_API_KEY")
    )
    if not base_url:
        fail("Missing IMAGE_GEN_BASE_URL / OTCBOT_BASE_URL / CPA_BASE_URL / OPENAI_BASE_URL")
    if not api_key:
        fail("Missing IMAGE_GEN_KEY / OTCBOT_API_KEY / CPA_API_KEY / OPENAI_API_KEY")

    if args.engine == "images" or (args.engine == "auto" and is_openai_image_model(args.model)):
        return call_openai_image_generation(args, base_url, api_key)
    if args.engine == "gemini" or (args.engine == "auto" and is_gemini_image_model(args.model)):
        return call_gemini_image(args, base_url, api_key)

    url = base_url.rstrip("/")
    if not url.endswith("/responses"):
        url = f"{url}/responses"

    last_raw = ""
    last_error = ""
    variants = input_variants(args.input_image)
    for variant_index, input_images in enumerate(variants):
        payload = {
            "model": model_for_responses(args.model),
            "input": build_input(args.prompt, input_images),
            "tools": [{"type": "image_generation", "output_format": args.format}],
            "instructions": args.instructions,
            "tool_choice": "auto",
            "stream": args.stream,
            "store": False,
        }
        for attempt in range(args.retries + 1):
            data = json.dumps(payload).encode("utf-8")
            headers = {
                "Authorization": f"Bearer {api_key}",
                "Accept": "text/event-stream" if args.stream else "application/json",
                "Content-Type": "application/json",
                "User-Agent": "SparkCanvas/0.1 image-generation-gpt",
                "version": "2026-05-16",
                "originator": "sparkcanvas-xmanx",
            }
            if args.session_id:
                headers["session_id"] = args.session_id
            req = urllib.request.Request(url, data=data, headers=headers, method="POST")

            try:
                with urllib.request.urlopen(req, timeout=120) as resp:
                    raw = resp.read().decode("utf-8", errors="replace")
                    status = resp.status
            except urllib.error.HTTPError as exc:
                body = exc.read().decode("utf-8", errors="replace")
                last_raw = body
                last_error = f"HTTP {exc.code}\n{body}"
                if attempt < args.retries and "rate_limit_exceeded" in body:
                    time.sleep(retry_delay(body))
                    continue
                if variant_index < len(variants) - 1 and exc.code in {429, 500, 502, 503, 504}:
                    break
                fail(last_error)
            except Exception as exc:
                last_error = f"Request failed: {exc}"
                if attempt < args.retries:
                    time.sleep(1.0 + attempt * 0.5)
                    continue
                if variant_index < len(variants) - 1:
                    break
                fail(last_error)

            if status < 200 or status >= 300:
                last_raw = raw
                last_error = f"Unexpected HTTP status: {status}\n{raw}"
                if variant_index < len(variants) - 1 and status in {429, 500, 502, 503, 504}:
                    break
                fail(last_error)

            parsed: Any = None
            if args.stream:
                events = parse_sse_events(raw)
                if events:
                    parsed = events
            if parsed is None:
                try:
                    parsed = json.loads(raw)
                except json.JSONDecodeError:
                    last_raw = raw
                    last_error = f"Response was not valid JSON or SSE:\n{raw[:4000]}"
                    if variant_index < len(variants) - 1:
                        break
                    fail(last_error)

            image_b64 = find_image_b64(parsed)
            if image_b64:
                out = Path(args.output)
                out.parent.mkdir(parents=True, exist_ok=True)
                out.write_bytes(base64.b64decode(image_b64))
                print(str(out))
                return 0

            last_raw = raw
            last_error = "No base64 image found in response.\n" + raw[:4000]
            if attempt < args.retries:
                if is_rate_limit_error(raw, parsed):
                    time.sleep(retry_delay(raw))
                    continue
                if has_tools_empty_fallback(raw, parsed):
                    time.sleep(1.0 + attempt * 0.5)
                    continue
            if variant_index < len(variants) - 1:
                break
            break

    fail(last_error or ("No base64 image found in response.\n" + last_raw[:4000]))
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
