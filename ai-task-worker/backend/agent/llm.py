import os, re, json, httpx
from dotenv import load_dotenv
load_dotenv()

def _json(t):
    cleaned = re.sub(r"^```(?:json)?", "", t.strip(), flags=re.MULTILINE)
    cleaned = re.sub(r"```$", "", cleaned.strip(), flags=re.MULTILINE).strip()
    m = re.search(r"\{.*\}", cleaned, re.S)
    if m:
        try:
            parsed = json.loads(m.group(0))
            if isinstance(parsed, dict) and "tool" in parsed:
                return parsed
        except Exception:
            pass
    return None



def _call_groq(system, msgs):
    api_key = os.environ.get("GROQ_API_KEY", "")
    model = os.getenv("GROQ_MODEL", "qwen/qwen3.8-27b")

    groq_msgs = [{"role": "system", "content": system + "\nIMPORTANT: Reply with a single raw JSON object only. Do NOT output commentary or markdown formatting."}]
    for m in msgs:
        groq_msgs.append({"role": m["role"], "content": m["content"]})

    body = {
        "model": model,
        "messages": groq_msgs,
        "temperature": 0
    }
    r = httpx.post(
        "https://api.groq.com/openai/v1/chat/completions",
        headers={"Authorization": f"Bearer {api_key}"},
        json=body,
        timeout=45
    )
    r.raise_for_status()
    content = r.json()["choices"][0]["message"]["content"]
    res = _json(content)
    if res: return res
    # Fallback retry without history noise
    r2 = httpx.post("https://api.groq.com/openai/v1/chat/completions", headers={"Authorization": f"Bearer {api_key}"}, json={
        "model": model, "messages": [{"role": "system", "content": system}, {"role": "user", "content": msgs[-1]["content"]}], "temperature": 0
    }, timeout=30)
    if r2.status_code == 200:
        res2 = _json(r2.json()["choices"][0]["message"]["content"])
        if res2: return res2
    return {"thought": "bad json", "tool": "finish", "args": {"status": "failed", "summary": "LLM returned invalid JSON"}}

TURN_COUNTER = 0

def decide(system, msgs):
    global TURN_COUNTER
    import time
    TURN_COUNTER += 1

    gemini_key = os.environ.get("GEMINI_API_KEY", "")
    gemini_model = os.getenv("MODEL") or "gemini-3.5-flash-lite"
    groq_key = os.environ.get("GROQ_API_KEY", "")

    # Alternating shift: Turn 1 -> Gemini, Turn 2 -> Groq, Turn 3 -> Gemini, etc.
    primary = "gemini" if (TURN_COUNTER % 2 == 1) else "groq"
    providers = [primary, "groq" if primary == "gemini" else "gemini"]

    errors = []
    for provider in providers:
        if provider == "gemini" and gemini_key:
            body = {
                "systemInstruction": {"parts": [{"text": system}]},
                "contents": [{"role": "user" if m["role"] == "user" else "model", "parts": [{"text": m["content"]}]} for m in msgs],
                "generationConfig": {"responseMimeType": "application/json", "temperature": 0}
            }
            for attempt in range(2):
                try:
                    r = httpx.post(
                        f"https://generativelanguage.googleapis.com/v1beta/models/{gemini_model}:generateContent?key={gemini_key}",
                        json=body,
                        timeout=25
                    )
                    if r.status_code == 200:
                        text = r.json()["candidates"][0]["content"]["parts"][0]["text"]
                        parsed = _json(text)
                        if parsed: return parsed
                    if r.status_code in (429, 503):
                        errors.append(f"Gemini {r.status_code}")
                        break
                except Exception as e:
                    errors.append(f"Gemini: {e}")
                    break

        elif provider == "groq" and groq_key:
            for attempt in range(3):
                try:
                    res = _call_groq(system, msgs)
                    if res and res.get("thought") != "bad json":
                        return res
                except httpx.HTTPStatusError as e:
                    if e.response.status_code == 429:
                        time.sleep(2 * (attempt + 1))
                        continue
                    errors.append(f"Groq {e.response.status_code}")
                    break
                except Exception as e:
                    errors.append(f"Groq: {e}")
                    time.sleep(1)

    # Final recovery: pause briefly and retry Groq
    if groq_key:
        try:
            time.sleep(2)
            return _call_groq(system, msgs)
        except Exception:
            pass

    raise RuntimeError(f"Both providers failed during rotational turn {TURN_COUNTER}: {'; '.join(errors)}")



