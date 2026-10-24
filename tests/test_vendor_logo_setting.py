"""Tests for the per-vendor logo settings.

Every logo used to live in one ``vendor_logos`` setting, which hit the 64 KiB setting limit after
a handful of uploads. Each vendor now has its own ``vendor_logo.<id>`` key, resolved dynamically.
"""

import json

import pytest

from spoolman.settings import SettingType, is_vendor_logo_key, parse_setting


@pytest.mark.parametrize("key", ["vendor_logo.1", "vendor_logo.42", "vendor_logo.9999999999999999999"])
def test_vendor_logo_keys_resolve(key: str):
    definition = parse_setting(key)
    assert definition.key == key
    assert definition.type == SettingType.STRING
    assert json.loads(definition.default) == ""
    assert is_vendor_logo_key(key)


@pytest.mark.parametrize(
    "key",
    [
        "vendor_logo.",
        "vendor_logo.0",
        "vendor_logo.01",
        "vendor_logo.-1",
        "vendor_logo.1a",
        "vendor_logo.1.2",
        "vendor_logo.99999999999999999999",
        "vendor_logo",
        "vendor_logox1",
    ],
)
def test_invalid_vendor_logo_keys_are_rejected(key: str):
    assert not is_vendor_logo_key(key)
    with pytest.raises(ValueError, match="does not exist"):
        parse_setting(key)


def test_registered_settings_still_resolve():
    assert parse_setting("currency").key == "currency"
    assert parse_setting("vendor_logos").type == SettingType.OBJECT
