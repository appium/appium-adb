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

# gsmCall
```javascript
let action = 'call';
await adb.gsmCall(4509, action);
```

Possible values:
 * call
 * accept
 * hold
 * cancel

# gsmSignal
```javascript
let signalStrengh = 0;
await adb.gsmSignal(signalStrengh);
```
Possible values: 0..4

# gsmVoice
```javascript
let state = 'roaming';
await adb.gsmVoice(state);
```

Possible values:

 * unregistered
 * home
 * roaming
 * searching
 * denied
 * off (unregistered alias)
 * on (home alias)

# sendSMS

```javascript
await adb.sendSMS(4509, "Hello Appium");
```

<img src="static/send-sms-screen.png" width="200" />
