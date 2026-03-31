# Tips

## Setting Up for Multi-Screen

Krohnkite supports multi-screen setup, 
but KWin has to be configured 
to unlock the full potential of the script.

1. Enable `Separate Screen Focus` feature:

- `System Settings` > `Window Management` > `Window Behavior` > `Multiscreen Behaviour`

  `OR` use console commands:

```
   kwriteconfig6 --file ~/.config/kwinrc --group Windows --key ActiveMouseScreen false
   kwriteconfig6 --file ~/.config/kwinrc --group Windows --key SeparateScreenFocus true
```

2. Bind keys for global shortcut `Switch to Next/Previous Screen`
   (Recommend: `Meta + ,` / `Meta + .`)
3. Bind keys for global shortcut `Window to Next/Previous Screen`
   (Recommend: `Meta + <` / `Meta + >`)

## Removing Title Bars

Breeze window decoration can be configured 
to completely remove title bars from all windows:

1. `System Setting` > `Application Style` > `Window Decorations`
2. Click `Configure Breeze` inside the decoration preview.
3. `Window-Specific Overrides` tab > `Add` button
4. Enter the followings, and press `Ok`:
   - `Regular expression to match`: `.*`
   - Tick `Hide window title bar`

## Changing Border Colors

Changing the border color makes it easier to identify current window. 
This is convenient if title bars are removed.

1. You can use the Oxygen decoration theme. [Oxygen theme settings][]
2. You can install third-party decorations, see [Border color conversation][]
3. You can add to the WM section in $HOME/.config/kdeglobals (this changes the default Breeze decoration frame colors):
    - `frame=R,G,B`
    - `inactiveFrame=R,G,B`

[Oxygen theme settings]: https://github.com/anametologin/krohnkite/assets/165245883/51b4cb48-33c7-4627-a119-33d1abbe2b99
[Border color conversation]: https://github.com/anametologin/krohnkite/issues/15

## Setting Minimum Geometry Size

Some applications like Discord and KDE settings don't tile nicely 
as they have a minimum size requirement.
This causes the applications to overlap with other applications. 
To mitigate this we can set minimum size for all windows to be 0.

1. `System Setting` > `Window Management` > `Window Rules`
2. Click on `+ Add New...`
3. Set `Window class` to be `Unimportant`
4. Set `Window types` to `Normal Window`
5. Click `+ Add Properties...`
6. Add the `Minimum Size` Property
7. Set the fields to `Force` and `0` x `0`
8. Apply

## Prevent borders and shadows from disappearing.

When a window is marked "maximized" in Breeze theme, 
its borders are removed to save screen space.
This behavior may not be preferable depending on your setup. 
This can be mitigated by disabling maximized windows using Window Rules.

1. `System Setting` > `Window Management` > `Window Rules`
2. Click on `+ Add New...`
3. Set `Window class` to be `Unimportant`
4. Set `Window types` to `Normal Window`
5. Click `+ Add Properties...`
6. Add the `Maximized horizontally` and `Maximized vertically` Properties.
7. Set the options to `Force` and `No`.
8. Apply

