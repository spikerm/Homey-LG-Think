# LG ThinQ — App Store review notes

## homey:manager:api permission

The `homey:manager:api` permission is used exclusively to read Homey Energy dynamic electricity price information.

The app:
- does not read unrelated Homey devices;
- does not read or modify Homey Flows;
- does not access user profile or account information through this permission;
- does not transmit Homey Energy price data to an external service;
- does not permanently store Homey Energy price histories.

Dynamic prices are processed locally on Homey to calculate the most economical operating window for supported appliances. A scheduled appliance plan stores only the calculated schedule information that is required for execution and replanning.

This permission is part of the app's intended Energy-aware appliance automation. Future versions are planned to add other LG ThinQ appliance categories, such as air conditioning, heat-pump/water-heating equipment and additional Energy-aware widgets.

## Why a separate LG ThinQ community app?

This app was created because supported washer/washer-dryer models can expose model-specific program fields that are not handled correctly by some existing community integrations. On the development model, this resulted in generic/default program values instead of usable program selection.

This implementation reads the appliance model profile and maps its model-specific ThinQ course fields, while also providing direct appliance control and Homey Energy-aware scheduling.

The app does not claim affiliation with or endorsement by LG Electronics.

## Current release scope

The first App Store release supports LG ThinQ washers and washer-dryers. The app ID and architecture are intentionally broader so additional compatible LG ThinQ appliance drivers and smart Energy widgets can be added in future releases.

## Tested development model

LG washer-dryer GD3V509S1
Model profile: F_V7_F___W.B_2QEUK

Tested functionality includes pairing, live state updates, program/settings control, Remote Start validation, direct start, scheduled start, Homey Energy dynamic pricing, user-cost formula application, plan persistence, automatic replanning and Smart Washing widget updates.


## Support and issue reporting

The public source repository is:
https://github.com/spikerm/Homey-LG-Think

User bug reports, unsupported-model reports and feature requests are collected through:
https://github.com/spikerm/Homey-LG-Think/issues

This gives users a public support channel and allows model-specific ThinQ compatibility issues to be tracked transparently.
