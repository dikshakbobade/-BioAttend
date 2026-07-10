import pymysql
import uuid
import hashlib
import base64
import bcrypt

DB_HOST = "localhost"
DB_USER = "root"
DB_PASS = "Pavilion@12345"
DB_NAME = "biometric_attendance"

def _pre_hash_password(password: str) -> bytes:
    hashed = hashlib.sha256(password.encode('utf-8')).digest()
    return base64.b64encode(hashed)

def get_password_hash(password: str) -> str:
    salt = bcrypt.gensalt()
    pwd_bytes = _pre_hash_password(password)
    return bcrypt.hashpw(pwd_bytes, salt).decode('utf-8')

def create_admin():
    username = "admin"
    password = "admin"
    email = "admin@company.com"
    hashed_password = get_password_hash(password)

    print(f"Connecting to MySQL at {DB_HOST}...")
    try:
        conn = pymysql.connect(
            host=DB_HOST,
            user=DB_USER,
            password=DB_PASS,
            database=DB_NAME
        )
        cursor = conn.cursor()
        print(f"Checking if user '{username}' exists...")
        cursor.execute("SELECT id FROM admin_users WHERE username = %s", (username,))
        existing = cursor.fetchone()

        if existing:
            print(f"User '{username}' exists. Updating password hash...")
            cursor.execute(
                "UPDATE admin_users SET password_hash = %s WHERE username = %s",
                (hashed_password, username)
            )
        else:
            print(f"Creating user '{username}'...")
            user_id = str(uuid.uuid4())
            cursor.execute(
                """INSERT INTO admin_users 
                   (id, username, email, password_hash, role, is_active, created_at, updated_at)
                   VALUES (%s, %s, %s, %s, 'SUPER_ADMIN', 1, NOW(), NOW())""",
                (user_id, username, email, hashed_password)
            )

        conn.commit()
        print("Done!")
        print(f"Username: {username}")
        print(f"Password: {password}")
        cursor.close()
        conn.close()
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    create_admin()