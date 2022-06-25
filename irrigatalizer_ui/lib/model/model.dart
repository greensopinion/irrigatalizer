import 'package:flutter/widgets.dart';

class LoadingModel<T> extends SafeChangeNotifier {
  bool _loading = false;
  final Future<void> Function(T) _loader;

  LoadingModel(this._loader);

  bool get loading => _loading;

  Future<void> load() async {
    _loading = true;
    notifyListeners();
    try {
      await _loader(this as T);
    } finally {
      _loading = false;
      notifyListeners();
    }
  }
}

class SafeChangeNotifier extends ChangeNotifier {
  bool _disposed = false;

  @override
  void notifyListeners() {
    if (!_disposed) {
      super.notifyListeners();
    }
  }

  @override
  void dispose() {
    _disposed = true;
    super.dispose();
  }
}
