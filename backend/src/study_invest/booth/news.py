"""Dinosaur-themed commentary on observed prices; never a pricing input."""

from fractions import Fraction

from .domain import SECTORS

HEADLINES = {
    "feed": {
        1: (
            "초식공룡 식탁에 초록불… 사료·바이오 주가 상승",
            "공룡알 투자자들 미소… 사료·바이오 오름세",
        ),
        -1: (
            "초식공룡 지갑도 다이어트… 사료·바이오 주가 하락",
            "공룡알 투자자들 숨 고르기… 사료·바이오 내림세",
        ),
        0: ("초식공룡 점심시간… 사료·바이오 주가 보합", "부화 기다리는 공룡알… 사료·바이오 제자리"),
    },
    "build": {
        1: (
            "판게아 건설주 기지개… 건설·자원 주가 상승",
            "화석보다 뜨거운 투자 열기… 건설·자원 오름세",
        ),
        -1: (
            "판게아 공사장 잠시 휴식… 건설·자원 주가 하락",
            "화석 투자자들 한숨… 건설·자원 내림세",
        ),
        0: ("판게아 대륙처럼 단단하게… 건설·자원 주가 보합", "화석 발굴 대기 중… 건설·자원 제자리"),
    },
    "space": {
        1: ("망원경에 잡힌 초록빛… 우주·방위 주가 상승", "공룡 우주선 상승 궤도… 우주·방위 오름세"),
        -1: (
            "공룡 우주선 고도 조절… 우주·방위 주가 하락",
            "관측소에 켜진 빨간불… 우주·방위 내림세",
        ),
        0: ("운석 관측 이상 없음… 우주·방위 주가 보합", "공룡 우주선 궤도 유지… 우주·방위 제자리"),
    },
}


def market_headline(
    previous: dict[str, int], current: dict[str, int], edition: int
) -> tuple[str, str]:
    sector = tuple(SECTORS)[(edition - 1) % len(SECTORS)]
    change = sum(Fraction(current[c] - previous[c], previous[c]) for c in SECTORS[sector]["codes"])
    direction = (change > 0) - (change < 0)
    variants = HEADLINES[sector][direction]
    return sector, variants[((edition - 1) // len(SECTORS)) % len(variants)]
