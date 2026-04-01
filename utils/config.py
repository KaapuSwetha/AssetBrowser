from pathlib import Path
import os
import yaml
import threading
import environ

env = environ.Env()

DEFAULT_SEARCH_PATHS = [
    Path(os.environ.get("CONFIG_PATH")) if os.environ.get("CONFIG_PATH") else None
]

_cache = {"data": None, "mtime": None, "path": None, "lock": threading.RLock()}

def _find_config_file():
    for p in DEFAULT_SEARCH_PATHS:
        if p is None:
            continue
        try:
            if p.exists():
                return p
        except Exception:
            continue
    raise FileNotFoundError("No config file found. Set CONFIG_PATH or place config/config.*.yaml")

def _load_yaml(path: Path):
    with path.open("r", encoding="utf-8") as fh:
        return yaml.safe_load(fh) or {}

def _deep_merge(a: dict, b: dict):
    out = dict(a)
    for k, v in (b or {}).items():
        if k in out and isinstance(out[k], dict) and isinstance(v, dict):
            out[k] = _deep_merge(out[k], v)
        else:
            out[k] = v
    return out

def _apply_env_overrides(cfg: dict):
    """
    Override nested keys using DOUBLE_UNDERSCORE env vars.
    Example: EMAIL__HOST overrides cfg['email']['host'].
    """
    def recurse(prefix, node):
        out = dict(node)
        for k, v in node.items():
            key_path = f"{prefix}__{k}" if prefix else k
            env_key = key_path.upper().replace("-", "_")
            if isinstance(v, dict):
                out[k] = recurse(key_path, v)
            else:
                if os.environ.get(env_key) is not None:
                    out[k] = os.environ.get(env_key)
                else:
                    out[k] = v
        return out
    return recurse("", cfg)

def load_config(config_path: str = None, reload_on_change: bool = False):
    with _cache["lock"]:
        if config_path:
            p = Path(config_path)
            if not p.exists():
                raise FileNotFoundError(f"Config not found: {p}")
            cfg_path = p
        else:
            cfg_path = _find_config_file()

        mtime = cfg_path.stat().st_mtime
        if reload_on_change and _cache["data"] is not None:
            if _cache["path"] == str(cfg_path) and _cache["mtime"] == mtime:
                return _cache["data"]

        base = _load_yaml(cfg_path)
        env_name = os.environ.get("DJANGO_ENV", os.environ.get("ENV", "dev"))
        defaults = base.get("defaults", {}) or {}
        env_overrides = base.get("env", {}).get(env_name, {}) or {}
        merged = _deep_merge(defaults, env_overrides)
        merged = _deep_merge(base, merged)
        merged = _apply_env_overrides(merged)

        _cache.update({"data": merged, "mtime": mtime, "path": str(cfg_path)})
        return merged
