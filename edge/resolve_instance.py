#!/usr/bin/env python3
"""Resolve control-plane instance endpoint, service key and PG host.

Reads credentials from environment or ~/.aliyun/config.json. The output file
contains secrets and must be kept private.
"""

import argparse
import base64
import hashlib
import hmac
import json
import os
import re
import socket
import sys
import urllib.error
import urllib.parse
import urllib.request
import uuid
from datetime import datetime, timezone
from pathlib import Path


def load_profile(name=None):
    path = Path.home() / ".aliyun" / "config.json"
    if not path.exists():
        return {}
    try:
        data = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError):
        return {}
    profiles = data.get("profiles") or []
    target = name or data.get("current")
    chosen = next((item for item in profiles if item.get("name") == target), None)
    if chosen is None and profiles:
        chosen = profiles[0]
    return chosen or {}


def resolve_credentials():
    profile = load_profile(os.environ.get("ALIBABA_CLOUD_PROFILE"))
    access_key_id = os.environ.get("ALIBABA_CLOUD_ACCESS_KEY_ID") or profile.get("access_key_id", "")
    access_key_secret = os.environ.get("ALIBABA_CLOUD_ACCESS_KEY_SECRET") or profile.get("access_key_secret", "")
    security_token = os.environ.get("ALIBABA_CLOUD_SECURITY_TOKEN") or profile.get("sts_token", "")
    if not access_key_id or not access_key_secret:
        raise RuntimeError("未找到 AK/SK：请设置 ALIBABA_CLOUD_ACCESS_KEY_ID/SECRET，或配置 ~/.aliyun/config.json")
    return access_key_id, access_key_secret, security_token, profile


def percent_encode(value):
    return urllib.parse.quote(str(value), safe="~")


def rpc(endpoint, action, version, body, credentials):
    access_key_id, access_key_secret, security_token = credentials
    params = {
        "AccessKeyId": access_key_id,
        "Action": action,
        "Format": "JSON",
        "SignatureMethod": "HMAC-SHA1",
        "SignatureNonce": uuid.uuid4().hex,
        "SignatureVersion": "1.0",
        "Timestamp": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),  # noqa: UP017 - Python 3.9
        "Version": version,
    }
    if security_token:
        params["SecurityToken"] = security_token
    for key, value in body.items():
        if value is not None:
            params[key] = str(value)
    canonical = "&".join(f"{percent_encode(key)}={percent_encode(params[key])}" for key in sorted(params))
    string_to_sign = f"POST&%2F&{percent_encode(canonical)}"
    signature = base64.b64encode(
        hmac.new(f"{access_key_secret}&".encode(), string_to_sign.encode(), hashlib.sha1).digest()
    ).decode()
    params["Signature"] = signature
    request = urllib.request.Request(
        f"https://{endpoint}/",
        data=urllib.parse.urlencode(params).encode(),
        method="POST",
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            data = json.loads(response.read().decode() or "{}")
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"{action} HTTP {exc.code}: {body[:300]}") from exc
    code = str(data.get("Code") or "")
    if code and code not in ("Success", "OK", "200"):
        raise RuntimeError(f"{action} 失败：{code}: {data.get('Message', '')}")
    return data


def pick_net(net_info):
    items = ((net_info.get("DBInstanceNetInfos") or {}).get("DBInstanceNetInfo")) or []
    if isinstance(items, dict):
        items = [items]
    public = next((item for item in items if str(item.get("IPType", "")).lower() == "public"), None)
    internal = next(
        (item for item in items if str(item.get("IPType", "")).lower() in ("inner", "private", "vpc")),
        None,
    )
    chosen = public or internal
    if not chosen:
        return None
    return {
        "host": str(chosen.get("ConnectionString") or ""),
        "port": int(chosen.get("Port") or 5432),
        "type": "public" if chosen is public else "vpc",
    }


def validate_admin_password(password):
    if not (8 <= len(password) <= 32):
        raise RuntimeError("pool_admin 密码长度必须为 8~32 位")
    classes = sum(
        bool(re.search(pattern, password)) for pattern in (r"[A-Z]", r"[a-z]", r"[0-9]", r"[_!@#$%^&*()+=\-]")
    )
    if classes < 3:
        raise RuntimeError("pool_admin 密码至少包含大写字母、小写字母、数字、特殊字符中的三类")


def ensure_control_database(db_instance_name, region, admin_user, admin_password, database, credentials, rds_endpoint):
    validate_admin_password(admin_password)
    account_body = {
        "RegionId": region,
        "DBInstanceId": db_instance_name,
        "AccountName": admin_user,
        "AccountPassword": admin_password,
        "AccountType": "Super",
        "AccountDescription": "pool control plane owner",
    }
    try:
        rpc(rds_endpoint, "CreateAccount", "2014-08-15", account_body, credentials)
    except RuntimeError as exc:
        message = str(exc).lower()
        if not any(token in message for token in ("exist", "duplicate", "已存在", "重复")):
            raise
        rpc(
            rds_endpoint,
            "ResetAccountPassword",
            "2014-08-15",
            {
                "RegionId": region,
                "DBInstanceId": db_instance_name,
                "AccountName": admin_user,
                "AccountPassword": admin_password,
            },
            credentials,
        )
    database_body = {
        "RegionId": region,
        "DBInstanceId": db_instance_name,
        "DBName": database,
        "CharacterSetName": "UTF8,C,en_US.utf8",
        "AccountName": admin_user,
        "AccountPrivilege": "DBOwner",
    }
    try:
        rpc(rds_endpoint, "CreateDatabase", "2014-08-15", database_body, credentials)
    except RuntimeError as exc:
        message = str(exc).lower()
        if not any(token in message for token in ("exist", "duplicate", "已存在", "重复")):
            raise
        try:
            rpc(
                rds_endpoint,
                "GrantAccountPrivilege",
                "2014-08-15",
                {
                    "RegionId": region,
                    "DBInstanceId": db_instance_name,
                    "AccountName": admin_user,
                    "DBName": database,
                    "AccountPrivilege": "DBOwner",
                },
                credentials,
            )
        except RuntimeError:
            pass
    return {"admin_user": admin_user, "control_db": database, "initialized": True}


def redact_secret(value):
    text = str(value or "")
    if not text:
        return ""
    return f"{text[:4]}***" if len(text) > 8 else "***"


def main():
    parser = argparse.ArgumentParser(description="解析 RDS Supabase 控制面实例信息")
    parser.add_argument("--instance", required=True, help="控制面 Supabase 实例名")
    parser.add_argument("--region", default="", help="地域，默认读取 profile 的 region_id")
    parser.add_argument("--output", default="", help="输出 JSON 文件（含敏感信息，权限 0600）")
    parser.add_argument(
        "--show-secrets", action="store_true", help="在标准输出中显示完整 service_key 和 AK/SK（默认脱敏）"
    )
    parser.add_argument("--init-control-db", action="store_true", help="创建 pool_admin 账号和 pool_control 数据库")
    parser.add_argument("--admin-user", default="pool_admin", help="控制面高权限账号")
    parser.add_argument("--admin-password", default="", help="控制面高权限账号密码")
    parser.add_argument("--control-db", default="pool_control", help="控制面业务数据库名")
    args = parser.parse_args()

    access_key_id, access_key_secret, security_token, profile = resolve_credentials()
    credentials = (access_key_id, access_key_secret, security_token)
    region = args.region or os.environ.get("DEFAULT_REGION") or profile.get("region_id")
    if not region:
        raise RuntimeError("请设置 REGION（实例所在地域），例如 cn-chengdu")
    shared_rdsai_regions = {
        "cn-beijing",
        "cn-hangzhou",
        "cn-shanghai",
        "cn-shenzhen",
        "cn-guangzhou",
        "cn-wulanchabu",
    }
    rdsai_endpoint = os.environ.get("RDSAI_ENDPOINT") or (
        "rdsai.aliyuncs.com" if region in shared_rdsai_regions else f"rdsai.{region}.aliyuncs.com"
    )
    rds_endpoint = os.environ.get("RDS_ENDPOINT") or "rds.aliyuncs.com"

    attribute = rpc(
        rdsai_endpoint,
        "DescribeAppInstanceAttribute",
        "2025-05-07",
        {"RegionId": region, "InstanceName": args.instance},
        credentials,
    )
    status = str(attribute.get("Status") or "")
    if status != "Running":
        raise RuntimeError(f"实例状态为 {status}，请等待 Running 后再执行")
    db_instance_name = str(attribute.get("DBInstanceName") or "")
    if not db_instance_name:
        raise RuntimeError("DescribeAppInstanceAttribute 未返回 DBInstanceName")

    auth = rpc(
        rdsai_endpoint,
        "DescribeInstanceAuthInfo",
        "2025-05-07",
        {"RegionId": region, "InstanceName": args.instance},
        credentials,
    )
    service_key = str((auth.get("ApiKeys") or {}).get("ServiceKey") or "")
    if not service_key:
        raise RuntimeError("DescribeInstanceAuthInfo 未返回 ServiceKey")

    endpoints = rpc(
        rdsai_endpoint,
        "DescribeInstanceEndpoints",
        "2025-05-07",
        {"RegionId": region, "InstanceName": args.instance},
        credentials,
    )
    endpoint_items = endpoints.get("InstanceEndpoints") or []
    public_endpoint = next(
        (
            item
            for item in endpoint_items
            if str(item.get("IpType", "")).lower() == "public" and str(item.get("Port")) == "443"
        ),
        None,
    ) or next((item for item in endpoint_items if str(item.get("IpType", "")).lower() == "public"), None)
    public_connection = str(
        (public_endpoint or {}).get("ConnectionString") or attribute.get("PublicConnectionString") or ""
    )
    public_port = str((public_endpoint or {}).get("Port") or "")
    domain = str((public_endpoint or {}).get("Domain") or "")
    domain_url = f"https://{domain}" if domain else ""
    if domain_url:
        public_url = domain_url
    elif public_connection:
        public_url = f"{'https' if public_port == '443' else 'http'}://{public_connection}"
    else:
        public_url = ""

    db_endpoints = endpoints.get("DBInstanceEndpoints") or []
    db_endpoint = next(
        (item for item in db_endpoints if str(item.get("IpType", "")).lower() in ("vpc", "private", "inner")),
        db_endpoints[0] if db_endpoints else None,
    )
    if db_endpoint and db_endpoint.get("ConnectionString"):
        pg = {
            "host": str(db_endpoint.get("ConnectionString")),
            "port": int(db_endpoint.get("Port") or 5432),
            "type": "vpc" if str(db_endpoint.get("IpType", "")).lower() in ("vpc", "private", "inner") else "public",
        }
    else:
        net_info = rpc(
            rds_endpoint,
            "DescribeDBInstanceNetInfo",
            "2014-08-15",
            {"RegionId": region, "DBInstanceId": db_instance_name},
            credentials,
        )
        pg = pick_net(net_info)
    if not pg or not pg["host"]:
        raise RuntimeError("控制面 PG 没有可用的连接地址")

    initialized = False
    if args.init_control_db:
        if not args.admin_password:
            raise RuntimeError("初始化控制面数据库需要 --admin-password")
        ensure_control_database(
            db_instance_name,
            region,
            args.admin_user,
            args.admin_password,
            args.control_db,
            credentials,
            rds_endpoint,
        )
        initialized = True

    supabase_url = domain_url or public_url
    if domain:
        try:
            socket.getaddrinfo(domain, 443)
        except OSError:
            supabase_url = public_url or domain_url
    result = {
        "instance_name": args.instance,
        "region": region,
        "status": status,
        "supabase_url": supabase_url,
        "public_url": public_url,
        "service_key": service_key,
        "pg_host": pg["host"],
        "pg_port": pg["port"],
        "pg_type": pg["type"],
        "pg_sslmode": "disable" if pg["type"] == "vpc" else "require",
        "admin_user": args.admin_user,
        "control_db": args.control_db,
        "initialized": initialized,
        "access_key_id": access_key_id,
        "access_key_secret": access_key_secret,
        "security_token": security_token,
    }
    if args.output:
        path = Path(args.output)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(result, ensure_ascii=False, indent=2))
        os.chmod(path, 0o600)
        print(
            json.dumps(
                {
                    "instance_name": result["instance_name"],
                    "region": result["region"],
                    "supabase_url": result["supabase_url"],
                    "pg_host": result["pg_host"],
                    "pg_type": result["pg_type"],
                },
                ensure_ascii=False,
            )
        )
    else:
        printable = result
        if not args.show_secrets:
            printable = {**result}
            for key in ("service_key", "access_key_id", "access_key_secret", "security_token"):
                if printable.get(key):
                    printable[key] = redact_secret(printable[key])
        print(json.dumps(printable, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # noqa: BLE001 - CLI boundary prints a friendly error
        print(f"错误：{exc}", file=sys.stderr)
        sys.exit(1)
