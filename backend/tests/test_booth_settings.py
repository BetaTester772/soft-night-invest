from datetime import datetime

import pytest

from study_invest.clock import ScaledClock
from study_invest.config import Settings
from study_invest.params import KST


def test_environment_defaults_to_booth_and_booth_clock_starts_before_open(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("STUDY_INVEST_EVENT_MODE", raising=False)
    monkeypatch.setenv("STUDY_INVEST_TIME_ORIGIN", "2026-10-27T17:00:00+09:00")
    monkeypatch.setenv("STUDY_INVEST_TIME_SCALE", "1")
    settings = Settings.from_env()
    assert settings.event_mode == "booth"
    clock = settings.make_clock()
    assert isinstance(clock, ScaledClock)
    assert clock.virtual_origin == datetime(2026, 10, 30, 15, 59, 50, tzinfo=KST)


@pytest.mark.parametrize(
    "address",
    [
        "javascript:alert(1)",
        "https://a.example/path",
        "https://user:pass@a.example",
        "https://a.example?secret=x",
        "//a.example",
    ],
)
def test_public_qr_url_must_be_a_plain_http_origin(address: str) -> None:
    with pytest.raises(ValueError, match="PUBLIC_URL"):
        Settings(booth_public_url=address)


def test_unknown_mode_does_not_silently_use_the_study_scheduler(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("STUDY_INVEST_EVENT_MODE", "booh")
    with pytest.raises(ValueError, match="EVENT_MODE"):
        Settings.from_env()
