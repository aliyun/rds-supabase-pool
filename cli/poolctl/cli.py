from __future__ import annotations

import argparse
import json
import os
import stat
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

CONFIG_DIR = Path(os.environ.get("POOLCTL_CONFIG_DIR") or (Path.home() / ".config" / "poolctl"))
CONFIG_FILE = CONFIG_DIR / "config.json"
DEFAULT_TIMEOUT = 30


class PoolCtlError(RuntimeError):
    pass


def load_config() -> dict[str, str]:
    try:
        data = json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {}


def save_config(data: dict[str, str]) -> None:
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    file = CONFIG_FILE
    file.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    file.chmod(stat.S_IRUSR | stat.S_IWUSR)


def resolve_config(args: argparse.Namespace) -> tuple[str, str]:
    config = load_config()
    url = (args.url or os.environ.get("POOLCTL_URL") or config.get("url") or "").rstrip("/")
    token = os.environ.get("POOLCTL_TOKEN") or config.get("token") or ""
    if not url:
        raise PoolCtlError("缺少服务地址，请先执行 poolctl login --url ... --token ...")
    if not token:
        raise PoolCtlError("缺少 API Token，请先执行 poolctl login，或设置 POOLCTL_TOKEN")
    return url, token


def api(
    args: argparse.Namespace,
    method: str,
    path: str,
    body: dict[str, Any] | None = None,
) -> Any:
    url, token = resolve_config(args)
    data = json.dumps(body).encode("utf-8") if body is not None else None
    request = urllib.request.Request(
        f"{url}{path}",
        data=data,
        method=method,
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/json",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=DEFAULT_TIMEOUT) as response:
            raw = response.read().decode("utf-8")
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="replace")
        try:
            payload = json.loads(raw)
            detail = payload.get("detail") or raw
        except json.JSONDecodeError:
            detail = raw or exc.reason
        raise PoolCtlError(f"HTTP {exc.code}: {detail}") from exc
    except urllib.error.URLError as exc:
        raise PoolCtlError(f"无法连接控制面：{exc.reason}") from exc


def output_json(value: Any) -> None:
    print(json.dumps(value, ensure_ascii=False, indent=2))


def output_table(headers: list[str], rows: list[list[Any]]) -> None:
    widths = [len(header) for header in headers]
    for row in rows:
        for index, value in enumerate(row):
            widths[index] = max(widths[index], len(str(value)))
    print("  ".join(header.ljust(widths[index]) for index, header in enumerate(headers)))
    print("  ".join("-" * width for width in widths))
    for row in rows:
        print("  ".join(str(value).ljust(widths[index]) for index, value in enumerate(row)))


def find_app(overview: dict[str, Any], app_name: str) -> dict[str, Any]:
    matches = [item for item in overview.get("instances", []) if item.get("app_name") == app_name]
    if not matches:
        raise PoolCtlError(f"未找到自己的应用：{app_name}")
    return matches[0]


def task_status(args: argparse.Namespace, task_id: str) -> dict[str, Any]:
    return api(args, "GET", f"/api/v1/portal/tasks/{task_id}")


def wait_task(args: argparse.Namespace, task_id: str, quiet: bool = False) -> dict[str, Any]:
    deadline = time.time() + max(1, args.timeout)
    last_message = ""
    while time.time() < deadline:
        task = task_status(args, task_id)
        message = f"{task.get('progress', 0)}% {task.get('message') or ''}".strip()
        if not quiet and message != last_message:
            print(f"[{task.get('status')}] {message}", file=sys.stderr)
            last_message = message
        if task.get("status") == "succeeded":
            return task
        if task.get("status") == "failed":
            raise PoolCtlError(f"任务失败：{task.get('error') or task.get('message') or task_id}")
        time.sleep(2)
    raise PoolCtlError(f"等待任务超时（{args.timeout}s）：{task_id}")


def cmd_login(args: argparse.Namespace) -> None:
    url = (args.url or "").rstrip("/")
    if not url:
        raise PoolCtlError("登录需要 --url")
    if not args.token:
        raise PoolCtlError("登录需要 --token（在门户「API Token」中创建）")
    # 用一个轻量请求验证 token 和地址，验证失败不覆盖原配置。
    previous = load_config()
    save_config({"url": url, "token": args.token})
    try:
        payload = api(args, "GET", "/api/v1/portal/overview")
    except Exception:
        save_config(previous)
        raise
    user = payload.get("user") or {}
    print(f"已登录 {user.get('display_name') or user.get('username')} ({user.get('username')}) @ {url}")


def cmd_whoami(args: argparse.Namespace) -> None:
    payload = api(args, "GET", "/api/v1/portal/overview")
    if args.json:
        output_json(payload.get("user") or {})
        return
    user = payload.get("user") or {}
    print(f"{user.get('display_name') or user.get('username')}  {user.get('username')}  {user.get('role')}")


def cmd_regions(args: argparse.Namespace) -> None:
    payload = api(args, "GET", "/api/v1/portal/overview")
    if args.json:
        output_json(payload.get("regions") or [])
        return
    rows = []
    for region in payload.get("regions", []):
        for pool in region.get("pools", []):
            rows.append(
                [
                    region.get("region_id", ""),
                    region.get("name", ""),
                    pool.get("mode_label", pool.get("mode", "")),
                    pool.get("available", 0),
                    pool.get("in_use", 0),
                    pool.get("target", 0),
                ]
            )
    if not rows:
        print("当前没有可申请的地域")
        return
    output_table(["REGION", "NAME", "MODE", "AVAILABLE", "IN_USE", "TARGET"], rows)


def cmd_apps(args: argparse.Namespace) -> None:
    payload = api(args, "GET", "/api/v1/portal/overview")
    if args.json:
        output_json(payload.get("instances") or [])
        return
    instances = payload.get("instances") or []
    rows = [
        [
            item.get("app_name", ""),
            item.get("region_name", ""),
            item.get("mode", ""),
            item.get("status", ""),
            "yes" if item.get("reserved") else "no",
            item.get("id", ""),
            item.get("supabase_instance_id") or "-",
        ]
        for item in instances
    ]
    if not rows:
        print("当前没有应用实例")
        return
    output_table(["APP", "REGION", "MODE", "STATUS", "RESERVED", "INSTANCE", "SUPABASE"], rows)


def cmd_apply(args: argparse.Namespace) -> None:
    payload = api(
        args,
        "POST",
        "/api/v1/portal/instances/apply",
        {"region_id": args.region, "app_name": args.app, "mode": args.mode},
    )
    if args.json and not args.wait:
        output_json(payload)
        return
    print(
        f"申请已提交：app={args.app} region={args.region} mode={args.mode} "
        f"task={payload.get('task_id')} instance={payload.get('instance_id')}"
    )
    if args.wait:
        wait_task(args, payload["task_id"], quiet=args.json)
        if args.json:
            overview = api(args, "GET", "/api/v1/portal/overview")
            output_json(find_app(overview, args.app))
        else:
            print(f"实例已就绪：{args.app}（{payload.get('instance_id')}）")


def cmd_get(args: argparse.Namespace) -> None:
    deadline = time.time() + max(1, args.timeout)
    while True:
        overview = api(args, "GET", "/api/v1/portal/overview")
        try:
            instance = find_app(overview, args.app)
        except PoolCtlError:
            if not args.wait or time.time() >= deadline:
                raise
            time.sleep(2)
            continue
        if args.json:
            output_json(instance)
            return
        print(f"应用      {instance.get('app_name')}")
        print(f"地域      {instance.get('region_name')} / {instance.get('region_id')}")
        print(f"池模式    {instance.get('mode')}")
        print(f"状态      {instance.get('status')}")
        print(f"保留      {'yes' if instance.get('reserved') else 'no'}")
        print(f"实例 ID   {instance.get('id')}")
        print(f"Supabase  {instance.get('supabase_instance_id') or '-'}")
        if instance.get("error"):
            print(f"错误      {instance.get('error')}")
        if not args.wait:
            return
        if instance.get("status") in {"InUse", "InCold", "Failed"}:
            return
        if time.time() >= deadline:
            raise PoolCtlError(f"等待实例就绪超时（{args.timeout}s）")
        time.sleep(2)


def cmd_task(args: argparse.Namespace) -> None:
    task = task_status(args, args.task_id)
    if args.wait:
        task = wait_task(args, args.task_id, quiet=args.json)
    output_json(task)


def cmd_connect(args: argparse.Namespace) -> None:
    overview = api(args, "GET", "/api/v1/portal/overview")
    instance = find_app(overview, args.app)
    instance_id = instance.get("id")
    endpoints = api(args, "GET", f"/api/v1/portal/instances/{instance_id}/endpoints")
    auth = api(args, "GET", f"/api/v1/portal/instances/{instance_id}/auth-info")
    if args.json:
        output_json({"instance": instance, "endpoints": endpoints, "auth": auth})
        return
    items = endpoints.get("instance_endpoints") or []
    preferred = None
    if args.vpc:
        preferred = next((item for item in items if str(item.get("ip_type", "")).lower() == "vpc"), None)
    if preferred is None:
        preferred = next((item for item in items if str(item.get("ip_type", "")).lower() == "public"), None)
    if preferred is None and items:
        preferred = items[0]
    keys = auth.get("api_keys") or {}
    if args.env:
        if preferred:
            host = str(preferred.get("ip") or str(preferred.get("connection_string", "")).rsplit(":", 1)[0])
            print(f"export SUPABASE_HOST={shell_quote(host)}")
            print(f"export SUPABASE_PORT={shell_quote(str(preferred.get('port', '')))}")
            print(f"export SUPABASE_CONNECTION={shell_quote(str(preferred.get('connection_string', '')))}")
        print(f"export SUPABASE_ANON_KEY={shell_quote(str(keys.get('anon_key', '')))}")
        if args.show_secrets:
            print(f"export SUPABASE_SERVICE_KEY={shell_quote(str(keys.get('service_key', '')))}")
        else:
            print("# Service Key 未输出；需要时追加 --show-secrets", file=sys.stderr)
        return
    print(f"应用      {instance.get('app_name')}")
    print(f"状态      {instance.get('status')}")
    for item in items:
        print(f"连接      [{item.get('ip_type', '-')}] {item.get('connection_string')}")
    print(f"Anon Key  {keys.get('anon_key') or '-'}")
    if args.show_secrets:
        print(f"Service   {keys.get('service_key') or '-'}")
    else:
        print("Service   （使用 --show-secrets 输出）")


def cmd_release(args: argparse.Namespace) -> None:
    overview = api(args, "GET", "/api/v1/portal/overview")
    instance = find_app(overview, args.app)
    if not args.yes:
        answer = input(f"确认归还应用 {args.app}？实例会停止但保留给同名应用复用 [y/N] ")
        if answer.strip().lower() not in {"y", "yes"}:
            print("已取消")
            return
    payload = api(args, "POST", f"/api/v1/portal/instances/{instance['id']}/release")
    if args.json and not args.wait:
        output_json(payload)
        return
    print(f"归还任务已提交：task={payload.get('task_id')}")
    if args.wait:
        wait_task(args, payload["task_id"], quiet=args.json)
        if args.json:
            output_json(task_status(args, payload["task_id"]))
        else:
            print(f"已归还：{args.app} 保留给同名应用复用")


def shell_quote(value: str) -> str:
    if not value:
        return "''"
    if all(char.isalnum() or char in "._:/@%+-" for char in value):
        return value
    return "'" + value.replace("'", "'\"'\"'") + "'"


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="poolctl", description="RDS Supabase 资源门户 CLI")
    parser.add_argument("--url", help="控制面地址，例如 https://<domain>/functions/v1/pool-api（也可用 POOLCTL_URL）")
    parser.add_argument("--json", action="store_true", help="以 JSON 输出")
    parser.add_argument("--timeout", type=int, default=900, help="等待任务/实例的秒数，默认 900")
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--json", action="store_true", default=argparse.SUPPRESS, help="以 JSON 输出")
    common.add_argument("--timeout", type=int, default=argparse.SUPPRESS, help="等待秒数")
    sub = parser.add_subparsers(dest="command", required=True)

    login = sub.add_parser("login", help="验证并保存 API Token")
    login.add_argument("--url", required=True)
    login.add_argument("--token", required=True, help="在门户 API Token 页面创建")
    login.set_defaults(func=cmd_login)

    whoami = sub.add_parser("whoami", help="显示当前账号", parents=[common])
    whoami.set_defaults(func=cmd_whoami)

    regions = sub.add_parser("regions", help="查看可申请地域和池模式", parents=[common])
    regions.set_defaults(func=cmd_regions)

    apps = sub.add_parser("apps", help="查看我的应用实例", parents=[common])
    apps.set_defaults(func=cmd_apps)

    apply_cmd = sub.add_parser("apply", help="申请实例", parents=[common])
    apply_cmd.add_argument("--app", required=True, help="应用名称")
    apply_cmd.add_argument("--region", required=True, help="地域 ID")
    apply_cmd.add_argument("--mode", required=True, choices=["single", "shared"], help="池模式")
    apply_cmd.add_argument("--wait", action="store_true", help="等待任务完成")
    apply_cmd.set_defaults(func=cmd_apply)

    get = sub.add_parser("get", help="查看应用实例", parents=[common])
    get.add_argument("app")
    get.add_argument("--wait", action="store_true", help="等待实例离开创建中状态")
    get.set_defaults(func=cmd_get)

    task = sub.add_parser("task", help="查看异步任务", parents=[common])
    task.add_argument("task_id")
    task.add_argument("--wait", action="store_true")
    task.set_defaults(func=cmd_task)

    connect = sub.add_parser("connect", help="查看连接信息", parents=[common])
    connect.add_argument("app")
    connect.add_argument("--env", action="store_true", help="输出 shell 环境变量")
    connect.add_argument("--show-secrets", action="store_true", help="包含 Service Key")
    connect.add_argument("--vpc", action="store_true", help="优先使用 VPC 连接地址")
    connect.set_defaults(func=cmd_connect)

    release = sub.add_parser("release", help="归还实例", parents=[common])
    release.add_argument("app")
    release.add_argument("--yes", action="store_true")
    release.add_argument("--wait", action="store_true")
    release.set_defaults(func=cmd_release)
    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()
    try:
        args.func(args)
    except PoolCtlError as exc:
        print(f"错误：{exc}", file=sys.stderr)
        raise SystemExit(1) from exc
    except KeyboardInterrupt:
        print("已取消", file=sys.stderr)
        raise SystemExit(130) from None


if __name__ == "__main__":
    main()
