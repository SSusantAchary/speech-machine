import os
import shutil
from pathlib import Path
from typing import BinaryIO

import boto3

from app.config import settings


class StorageClient:
    def __init__(self) -> None:
        self.use_s3 = settings.storage_backend == "s3" or all(
            [
                settings.s3_endpoint,
                settings.s3_access_key,
                settings.s3_secret_key,
                settings.s3_bucket,
            ]
        )
        if self.use_s3:
            missing = [
                name
                for name, value in {
                    "S3_ENDPOINT": settings.s3_endpoint,
                    "S3_ACCESS_KEY": settings.s3_access_key,
                    "S3_SECRET_KEY": settings.s3_secret_key,
                    "S3_BUCKET": settings.s3_bucket,
                }.items()
                if not value
            ]
            if missing:
                raise RuntimeError(f"S3 storage is enabled but missing: {', '.join(missing)}")
            self.s3 = boto3.client(
                "s3",
                endpoint_url=settings.s3_endpoint,
                aws_access_key_id=settings.s3_access_key,
                aws_secret_access_key=settings.s3_secret_key,
                region_name=settings.s3_region,
            )
            self.bucket = settings.s3_bucket
        else:
            self.s3 = None
            self.bucket = None
            Path(settings.storage_dir).mkdir(parents=True, exist_ok=True)

    def save_file(self, key: str, file_obj: BinaryIO) -> str:
        if self.use_s3 and self.s3 and self.bucket:
            self.s3.upload_fileobj(file_obj, self.bucket, key)
            return f"s3://{self.bucket}/{key}"
        path = Path(settings.storage_dir) / key
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, "wb") as out:
            shutil.copyfileobj(file_obj, out)
        return str(path)

    def delete_file(self, key_or_path: str) -> None:
        if key_or_path.startswith("s3://") and self.use_s3 and self.s3 and self.bucket:
            key = key_or_path.replace(f"s3://{self.bucket}/", "")
            self.s3.delete_object(Bucket=self.bucket, Key=key)
            return
        if os.path.exists(key_or_path):
            os.remove(key_or_path)

    def get_local_path(self, key_or_path: str) -> str:
        if key_or_path.startswith("s3://"):
            raise RuntimeError("S3 file requires download")
        return key_or_path


storage_client = StorageClient()
