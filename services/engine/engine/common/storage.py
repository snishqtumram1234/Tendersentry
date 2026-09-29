"""Supabase Storage via its S3-compatible endpoint, using the engine's own scoped credentials
(spec ADR-004: the engine never touches Postgres; it reads/writes files directly)."""

from __future__ import annotations

import boto3
from botocore.client import Config as BotoConfig

from engine.config import settings

_client = None


def s3_client():
    global _client
    if _client is None:
        _client = boto3.client(
            "s3",
            endpoint_url=settings.storage_endpoint,
            region_name=settings.storage_region,
            aws_access_key_id=settings.storage_access_key,
            aws_secret_access_key=settings.storage_secret_key,
            config=BotoConfig(s3={"addressing_style": "path"}),
        )
    return _client


def get_object_bytes(bucket: str, key: str) -> bytes:
    resp = s3_client().get_object(Bucket=bucket, Key=key)
    return resp["Body"].read()
