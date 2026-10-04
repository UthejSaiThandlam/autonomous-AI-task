import re
SENSITIVE = re.compile(r"delete|remove|pay|transfer|send|email|publish", re.I)

def needs_approval(tool: str, args: dict) -> bool:
    """Irreversible / financial / outbound actions pause for a human."""
    if tool in ("fill", "click", "goto"):
        return bool(SENSITIVE.search(str(args.get("selector", "")) + str(args.get("url", "")) + str(args.get("value", ""))[:40]))
    return False
