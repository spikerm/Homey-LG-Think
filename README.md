# LG ThinQ for Homey

Community-developed LG ThinQ integration for Homey.

The first release focuses on LG ThinQ washers and washer-dryers, including direct program control, live status and a Smart Washing widget that can schedule a wash using Homey Energy dynamic electricity prices.

## Current status

App Store Release Candidate: **v0.7.1**

Validated successfully with:

```text
homey app validate --level publish
```

The `homey:manager:api` permission is used exclusively to read Homey Energy dynamic electricity price information for local Energy-aware scheduling.

## Planned expansion

The app architecture is intended to support additional LG ThinQ appliance categories and Energy-aware widgets in future versions, including air conditioning, heat-pump/water-heating equipment and other compatible ThinQ devices.

## Issues and feature requests

Please use GitHub Issues for bug reports, unsupported LG ThinQ models and feature requests.

## Disclaimer

This is a community-developed Homey app and is not an official LG Electronics application. LG and ThinQ are trademarks of their respective owners.
