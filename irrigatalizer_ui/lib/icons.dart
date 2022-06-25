import 'package:flutter/widgets.dart';

final AppIcon icons = AppIcon();

class AppIcon {
  Image waterOn() => _icon('sprinkler-variant');
  Image waterOff() => _icon('water-off');

  Image _icon(String name) => Image(
      image: AssetImage('icons/${name}_$_size.png'),
      width: _size.toDouble(),
      height: _size.toDouble());
}

const _size = 24;
