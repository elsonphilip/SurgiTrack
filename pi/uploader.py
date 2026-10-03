"""Post a finished session to the website (POST /api/sessions)."""
import json
import urllib.error
import urllib.request


class UploadError(Exception):
    pass


def post_session(site, payload, api_key=None, timeout=10):
    req = urllib.request.Request(
        site.rstrip("/") + "/api/sessions",
        data=json.dumps(payload).encode(),
        headers={"content-type": "application/json", **({"authorization": f"Bearer {api_key}"} if api_key else {})},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        try:
            msg = json.loads(e.read()).get("error", e.reason)
        except Exception:
            msg = e.reason
        raise UploadError(f"site rejected the session ({e.code}): {msg}") from e
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        raise UploadError(f"could not reach the site at {site}: {e}") from e
