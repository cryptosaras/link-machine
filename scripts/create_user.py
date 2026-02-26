"""Create an admin user for Link Machine.

Usage:
    python scripts/create_user.py --username admin --password yourpassword

Run from the project root directory.
Requires DATABASE_URL environment variable or .env file.
"""

import argparse
import asyncio
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))

from app.auth.service import hash_password
from app.database import async_session
from app.models.user import User


async def create_user(username: str, password: str):
    async with async_session() as session:
        user = User(username=username, password_hash=hash_password(password))
        session.add(user)
        await session.commit()
        print(f"User '{username}' created successfully.")


def main():
    parser = argparse.ArgumentParser(description="Create admin user")
    parser.add_argument("--username", required=True)
    parser.add_argument("--password", required=True)
    args = parser.parse_args()
    asyncio.run(create_user(args.username, args.password))


if __name__ == "__main__":
    main()
