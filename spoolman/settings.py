"""Settings that can be changed by the user.

All settings are JSON encoded and stored in the database.
"""

import json
import re
from dataclasses import dataclass
from enum import Enum


class SettingType(Enum):
    """The type of a setting."""

    BOOLEAN = "boolean"
    NUMBER = "number"
    STRING = "string"
    ARRAY = "array"
    OBJECT = "object"


@dataclass
class SettingDefinition:
    """A setting that can be changed by the user."""

    key: str
    type: SettingType
    default: str

    def validate_type(self, value: str) -> None:  # noqa: C901
        """Validate that the value has the correct type."""
        obj = json.loads(value)
        if self.type == SettingType.BOOLEAN:
            if not isinstance(obj, bool):
                raise ValueError(f"Setting {self.key} must be a boolean.")
        elif self.type == SettingType.NUMBER:
            if not isinstance(obj, (int, float)):
                raise ValueError(f"Setting {self.key} must be a number.")
        elif self.type == SettingType.STRING:
            if not isinstance(obj, str):
                raise ValueError(f"Setting {self.key} must be a string.")
        elif self.type == SettingType.ARRAY:
            if not isinstance(obj, list):
                raise ValueError(f"Setting {self.key} must be an array.")
        elif self.type == SettingType.OBJECT:  # noqa: SIM102
            if not isinstance(obj, dict):
                raise ValueError(f"Setting {self.key} must be an object.")


SETTINGS: dict[str, SettingDefinition] = {}


def register_setting(key: str, typ: SettingType, default: str) -> None:
    """Register a setting."""
    SETTINGS[key] = SettingDefinition(key, typ, default)


# A vendor's logo for printing on labels, as an image data URL, under "vendor_logo.<vendor id>".
# One setting per vendor so each logo gets the full setting size limit to itself. Not a vendor
# extra field: every spool response embeds its vendor, and a logo in each would bloat them.
VENDOR_LOGO_PREFIX = "vendor_logo."
_VENDOR_LOGO_KEY = re.compile(rf"^{re.escape(VENDOR_LOGO_PREFIX)}[1-9][0-9]{{0,18}}$")


def is_vendor_logo_key(key: str) -> bool:
    """Whether a key names a per-vendor logo setting."""
    return _VENDOR_LOGO_KEY.match(key) is not None


def parse_setting(key: str) -> SettingDefinition:
    """Parse a setting key."""
    if key in SETTINGS:
        return SETTINGS[key]
    if is_vendor_logo_key(key):
        return SettingDefinition(key, SettingType.STRING, json.dumps(""))
    raise ValueError(f"Setting {key} does not exist.")


register_setting("currency", SettingType.STRING, json.dumps("EUR"))
register_setting("round_prices", SettingType.BOOLEAN, json.dumps(obj=False))
register_setting("print_presets", SettingType.ARRAY, json.dumps([]))
register_setting("label_designs", SettingType.ARRAY, json.dumps([]))
# Superseded by the per-vendor settings below: it held every logo in one value, which quickly
# ran into the 64 KiB setting limit. Kept registered so clients can move old logos across.
register_setting("vendor_logos", SettingType.OBJECT, json.dumps({}))

register_setting("extra_fields_vendor", SettingType.ARRAY, json.dumps([]))
register_setting("extra_fields_filament", SettingType.ARRAY, json.dumps([]))
register_setting("extra_fields_spool", SettingType.ARRAY, json.dumps([]))
register_setting("base_url", SettingType.STRING, json.dumps(""))

register_setting("locations", SettingType.ARRAY, json.dumps([]))
register_setting("locations_spoolorders", SettingType.OBJECT, json.dumps({}))

# The dashboard groups spools by a field the user picks (location, lot_nr, material, or a spool
# extra field), so its layout is stored per field rather than per location like the two settings
# above. dashboard_groups maps a field key to its ordered group keys ("" being the unset group);
# dashboard_spoolorders maps a field key to a group key to its ordered spool ids.
register_setting("dashboard_groups", SettingType.OBJECT, json.dumps({}))
register_setting("dashboard_spoolorders", SettingType.OBJECT, json.dumps({}))
