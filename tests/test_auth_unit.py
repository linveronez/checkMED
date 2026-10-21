import pytest

from backend.auth import normalize_email, valid_password


def test_email_is_trimmed_and_casefolded():
    assert normalize_email("  LINCE@Example.com ") == "lince@example.com"


@pytest.mark.parametrize("value", [None, "sem-arroba", "x@y", "a" * 255 + "@example.com"])
def test_invalid_emails_are_rejected(value):
    with pytest.raises(ValueError):
        normalize_email(value)


def test_password_rules_enforce_length_and_email_difference():
    assert valid_password("senha-segura", "pessoa@example.com")
    assert not valid_password("curta", "pessoa@example.com")
    assert not valid_password("pessoa@example.com", "pessoa@example.com")
    assert not valid_password("a" * 129, "pessoa@example.com")
