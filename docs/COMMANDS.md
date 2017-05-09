# Usage

# getAdbVersion

```javascript
await adb.getAdbVersion();
```

```json
{
  "versionString": "1.0.39",
  "versionFloat": 1,
  "major": 1,
  "minor": 0,
  "patch": 39
}
```

# powerAC

```javascript
let state = 'off';
await adb.powerAC(state);
```
Possible values:
 * on
 * off

# powerCapacity
```javascript
let batteryPercent = 50;
await adb.powerAC(batteryPercent);
```

# powerOFF
```javascript
await adb.powerOFF();
```

# sendSMS

```javascript
await adb.sendSMS(4509, "Hello Appium");
```

<details>
  <summary></summary>
  <img src="static/send-sms-screen.png" width="200" />
</details>
