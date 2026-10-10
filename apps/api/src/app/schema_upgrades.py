from sqlalchemy import inspect

from app.db import engine


SESSION_COLUMN_DDL: dict[str, str] = {
    "document_path": "ALTER TABLE sessions ADD COLUMN document_path VARCHAR(1024)",
    "document_name": "ALTER TABLE sessions ADD COLUMN document_name VARCHAR(255)",
    "document_mime_type": "ALTER TABLE sessions ADD COLUMN document_mime_type VARCHAR(255)",
    "document_blocks_json": "ALTER TABLE sessions ADD COLUMN document_blocks_json TEXT",
}


def apply_startup_schema_upgrades() -> None:
    inspector = inspect(engine)
    if "sessions" not in inspector.get_table_names():
        return

    existing_columns = {column["name"] for column in inspector.get_columns("sessions")}
    statements = [ddl for column_name, ddl in SESSION_COLUMN_DDL.items() if column_name not in existing_columns]
    if not statements:
        return

    with engine.begin() as connection:
        for statement in statements:
            connection.exec_driver_sql(statement)
