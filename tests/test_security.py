import re

from backend.security import (hash_password, new_recovery_code,
                              new_session_token, recovery_hash,
                              token_hash, verify_password,
                              verify_recovery_code)


def test_password_hash_uses_scrypt_and_verifies():
    encoded = hash_password("senha segura")
    assert encoded.startswith("scrypt$")
    assert verify_password("senha segura", encoded)
    assert not verify_password("senha errada", encoded)


def test_recovery_code_has_about_one_hundred_bits_and_compares_normalized():
    code = new_recovery_code()
    assert re.fullmatch(r"[A-Z2-7]{4}(?:-[A-Z2-7]{4}){4}", code)
    assert verify_recovery_code(code.lower(), recovery_hash(code))
    assert not verify_recovery_code(new_recovery_code(), recovery_hash(code))


def test_session_tokens_are_random_and_only_hashes_are_stored():
    token = new_session_token()
    assert len(token) >= 40
    assert token_hash(token) != token
