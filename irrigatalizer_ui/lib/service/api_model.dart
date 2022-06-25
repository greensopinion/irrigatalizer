class Cycle {
  final String circuit;
  final DateTime start;
  final DateTime end;

  Cycle({required this.circuit, required this.start, required this.end});
}

class Status {
  final Cycle? current;
  final Cycle? next;

  Status({this.current, this.next});
}
