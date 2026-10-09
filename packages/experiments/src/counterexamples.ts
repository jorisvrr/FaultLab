import type { CounterexamplePreset } from './presets';

/**
 * Stored counterexamples as experiment specs (CP5). GENERATED once from the fixture files named in
 * `source`; those files stay the single source of truth and are never modified. The test
 * `counterexample-presets.test.ts` checks every entry against its fixture, so they cannot drift.
 */
export const COUNTEREXAMPLES: readonly CounterexamplePreset[] = [
  {
    "id": "cx-naive-leader.crash-only.unique-leader-per-epoch",
    "title": "naive-leader: crashes alone reuse an epoch, no network fault (CP2 finding; stored as a fixture in CP4 after crash/recover-only exploration)",
    "source": "packages/engine/test/counterexamples/naive-leader.crash-only.unique-leader-per-epoch.json",
    "format": "faultlab-counterexample/1",
    "spec": {
      "format": "faultlab-experiment/1",
      "seed": 0,
      "nodes": [
        "n1",
        "n2",
        "n3",
        "n4"
      ],
      "protocol": {
        "name": "naive-leader",
        "version": "1",
        "options": {
          "interval": 20,
          "jitter": 5,
          "timeout": 60
        }
      },
      "network": {
        "latency": {
          "min": 1,
          "max": 10
        }
      },
      "limits": {
        "maxTime": 1000
      },
      "faults": [
        {
          "at": 0,
          "type": "crash",
          "node": "n1"
        },
        {
          "at": 0,
          "type": "crash",
          "node": "n4"
        },
        {
          "at": 71,
          "type": "recover",
          "node": "n1"
        },
        {
          "at": 0,
          "type": "crash",
          "node": "n2"
        },
        {
          "at": 70,
          "type": "crash",
          "node": "n3"
        }
      ],
      "invariants": [
        {
          "id": "unique-leader-per-epoch",
          "version": "1"
        }
      ]
    },
    "expected": {
      "engineVersion": "0.4.0-cp4",
      "reason": "invariant-violation",
      "fingerprint": "2205e14a",
      "violation": {
        "invariantId": "unique-leader-per-epoch",
        "time": 140,
        "nodes": [
          "n3",
          "n1"
        ],
        "observed": "Epoch 1 was led by n3 and later also by n1",
        "eventNumber": 30
      }
    }
  },
  {
    "id": "cx-naive-leader.single-leader",
    "title": "naive-leader: split brain: two simultaneous leaders (found by fault exploration)",
    "source": "packages/engine/test/counterexamples/naive-leader.single-leader.json",
    "format": "faultlab-counterexample/1",
    "spec": {
      "format": "faultlab-experiment/1",
      "seed": 11,
      "nodes": [
        "n1",
        "n2",
        "n3",
        "n4"
      ],
      "protocol": {
        "name": "naive-leader",
        "version": "1",
        "options": {
          "interval": 20,
          "jitter": 5,
          "timeout": 60
        }
      },
      "network": {
        "latency": {
          "min": 1,
          "max": 10
        }
      },
      "limits": {
        "maxTime": 1000
      },
      "faults": [
        {
          "at": 150,
          "type": "partition",
          "groups": [
            [
              "n3"
            ]
          ]
        }
      ],
      "invariants": [
        {
          "id": "single-leader",
          "version": "1"
        }
      ]
    },
    "expected": {
      "engineVersion": "0.3.0-cp2",
      "reason": "invariant-violation",
      "fingerprint": "c5be175f",
      "violation": {
        "invariantId": "single-leader",
        "time": 209,
        "nodes": [
          "n3",
          "n4"
        ],
        "observed": "2 running nodes are leader: n3, n4",
        "eventNumber": 129
      }
    }
  },
  {
    "id": "cx-naive-leader.unique-leader-per-epoch",
    "title": "naive-leader: two leaders of the same epoch over the run (found by fault exploration)",
    "source": "packages/engine/test/counterexamples/naive-leader.unique-leader-per-epoch.json",
    "format": "faultlab-counterexample/1",
    "spec": {
      "format": "faultlab-experiment/1",
      "seed": 11,
      "nodes": [
        "n1",
        "n2",
        "n3",
        "n4"
      ],
      "protocol": {
        "name": "naive-leader",
        "version": "1",
        "options": {
          "interval": 20,
          "jitter": 5,
          "timeout": 60
        }
      },
      "network": {
        "latency": {
          "min": 1,
          "max": 10
        }
      },
      "limits": {
        "maxTime": 1000
      },
      "faults": [
        {
          "at": 150,
          "type": "partition",
          "groups": [
            [
              "n3"
            ]
          ]
        },
        {
          "at": 196,
          "type": "partition",
          "groups": [
            [
              "n3",
              "n4"
            ]
          ]
        }
      ],
      "invariants": [
        {
          "id": "unique-leader-per-epoch",
          "version": "1"
        }
      ]
    },
    "expected": {
      "engineVersion": "0.3.0-cp2",
      "reason": "invariant-violation",
      "fingerprint": "9e7ae94a",
      "violation": {
        "invariantId": "unique-leader-per-epoch",
        "time": 249,
        "nodes": [
          "n3",
          "n2"
        ],
        "observed": "Epoch 2 was led by n3 and later also by n2",
        "eventNumber": 142
      }
    }
  },
  {
    "id": "cx-raft.ceil-half-majority.raft-election-safety",
    "title": "raft-election/bug:ceil-half-majority: two disjoint halves of a 4-node cluster can both elect a leader in one term (found by fault exploration)",
    "source": "packages/protocols/test/counterexamples/raft.ceil-half-majority.raft-election-safety.json",
    "format": "faultlab-counterexample/2",
    "spec": {
      "format": "faultlab-experiment/1",
      "seed": 2989984903,
      "nodes": [
        "n1",
        "n2",
        "n3",
        "n4"
      ],
      "protocol": {
        "name": "raft-election/bug:ceil-half-majority",
        "version": "1",
        "options": {}
      },
      "network": {
        "latency": {
          "min": 1,
          "max": 10
        }
      },
      "limits": {
        "maxTime": 2500
      },
      "faults": [
        {
          "at": 0,
          "type": "partition",
          "groups": [
            [
              "n1",
              "n2"
            ],
            [
              "n3",
              "n4"
            ]
          ]
        }
      ],
      "invariants": [
        {
          "id": "raft-election-safety",
          "version": "1"
        }
      ]
    },
    "expected": {
      "engineVersion": "0.4.0-cp4",
      "reason": "invariant-violation",
      "fingerprint": "7d9c3383",
      "violation": {
        "invariantId": "raft-election-safety",
        "time": 245,
        "nodes": [
          "n3",
          "n1"
        ],
        "observed": "Term 1 was led by n3 and also by n1",
        "eventNumber": 16
      }
    }
  },
  {
    "id": "cx-raft.ceil-half-majority.raft-leader-has-quorum",
    "title": "raft-election/bug:ceil-half-majority: ⌈n/2⌉ is not a majority for even n: 2 of 4 votes elect a leader (found by fault exploration)",
    "source": "packages/protocols/test/counterexamples/raft.ceil-half-majority.raft-leader-has-quorum.json",
    "format": "faultlab-counterexample/2",
    "spec": {
      "format": "faultlab-experiment/1",
      "seed": 0,
      "nodes": [
        "n1",
        "n2",
        "n3",
        "n4"
      ],
      "protocol": {
        "name": "raft-election/bug:ceil-half-majority",
        "version": "1",
        "options": {}
      },
      "network": {
        "latency": {
          "min": 1,
          "max": 10
        }
      },
      "limits": {
        "maxTime": 2500
      },
      "faults": [],
      "invariants": [
        {
          "id": "raft-leader-has-quorum",
          "version": "1"
        }
      ]
    },
    "expected": {
      "engineVersion": "0.4.0-cp4",
      "reason": "invariant-violation",
      "fingerprint": "44751c0e",
      "violation": {
        "invariantId": "raft-leader-has-quorum",
        "time": 206,
        "nodes": [
          "n4",
          "n2"
        ],
        "observed": "2 vote(s) evidenced (n4, n2); 3 required",
        "eventNumber": 7
      }
    }
  },
  {
    "id": "cx-raft.double-vote.raft-election-safety",
    "title": "raft-election/bug:double-vote: double votes let two candidates both reach a majority in one term (found by fault exploration)",
    "source": "packages/protocols/test/counterexamples/raft.double-vote.raft-election-safety.json",
    "format": "faultlab-counterexample/2",
    "spec": {
      "format": "faultlab-experiment/1",
      "seed": 2911200105,
      "nodes": [
        "n1",
        "n2",
        "n3"
      ],
      "protocol": {
        "name": "raft-election/bug:double-vote",
        "version": "1",
        "options": {}
      },
      "network": {
        "latency": {
          "min": 1,
          "max": 25
        }
      },
      "limits": {
        "maxTime": 2500
      },
      "faults": [],
      "invariants": [
        {
          "id": "raft-election-safety",
          "version": "1"
        }
      ]
    },
    "expected": {
      "engineVersion": "0.4.0-cp4",
      "reason": "invariant-violation",
      "fingerprint": "02478510",
      "violation": {
        "invariantId": "raft-election-safety",
        "time": 206,
        "nodes": [
          "n2",
          "n3"
        ],
        "observed": "Term 1 was led by n2 and also by n3",
        "eventNumber": 11
      }
    }
  },
  {
    "id": "cx-raft.double-vote.raft-one-vote-per-term",
    "title": "raft-election/bug:double-vote: every RequestVote of the current term is granted, ignoring votedFor (found by fault exploration)",
    "source": "packages/protocols/test/counterexamples/raft.double-vote.raft-one-vote-per-term.json",
    "format": "faultlab-counterexample/2",
    "spec": {
      "format": "faultlab-experiment/1",
      "seed": 2911200104,
      "nodes": [
        "n1",
        "n2",
        "n3"
      ],
      "protocol": {
        "name": "raft-election/bug:double-vote",
        "version": "1",
        "options": {}
      },
      "network": {
        "latency": {
          "min": 1,
          "max": 25
        }
      },
      "limits": {
        "maxTime": 2500
      },
      "faults": [],
      "invariants": [
        {
          "id": "raft-one-vote-per-term",
          "version": "1"
        }
      ]
    },
    "expected": {
      "engineVersion": "0.4.0-cp4",
      "reason": "invariant-violation",
      "fingerprint": "b020db59",
      "violation": {
        "invariantId": "raft-one-vote-per-term",
        "time": 178,
        "nodes": [
          "n2",
          "n3"
        ],
        "observed": "n2 voted for n2 and then for n3 in term 1",
        "eventNumber": 7
      }
    }
  },
  {
    "id": "cx-raft.ignore-higher-term.raft-term-adoption",
    "title": "raft-election/bug:ignore-higher-term: messages with a higher term are ignored instead of adopted (found by fault exploration)",
    "source": "packages/protocols/test/counterexamples/raft.ignore-higher-term.raft-term-adoption.json",
    "format": "faultlab-counterexample/2",
    "spec": {
      "format": "faultlab-experiment/1",
      "seed": 0,
      "nodes": [
        "n1",
        "n2",
        "n3"
      ],
      "protocol": {
        "name": "raft-election/bug:ignore-higher-term",
        "version": "1",
        "options": {}
      },
      "network": {
        "latency": {
          "min": 1,
          "max": 10
        }
      },
      "limits": {
        "maxTime": 2500
      },
      "faults": [],
      "invariants": [
        {
          "id": "raft-term-adoption",
          "version": "1"
        }
      ]
    },
    "expected": {
      "engineVersion": "0.4.0-cp4",
      "reason": "invariant-violation",
      "fingerprint": "62bdc088",
      "violation": {
        "invariantId": "raft-term-adoption",
        "time": 260,
        "nodes": [
          "n3",
          "n1"
        ],
        "observed": "n3 stayed in term 0",
        "eventNumber": 5
      }
    }
  },
  {
    "id": "cx-raft.no-step-down.raft-election-safety",
    "title": "raft-election/bug:no-step-down: a leader that meets a higher term adopts it but keeps leading, next to the leader elected in that term (found by fault exploration)",
    "source": "packages/protocols/test/counterexamples/raft.no-step-down.raft-election-safety.json",
    "format": "faultlab-counterexample/2",
    "spec": {
      "format": "faultlab-experiment/1",
      "seed": 162726398,
      "nodes": [
        "n1",
        "n2",
        "n3",
        "n4",
        "n5"
      ],
      "protocol": {
        "name": "raft-election/bug:no-step-down",
        "version": "1",
        "options": {}
      },
      "network": {
        "latency": {
          "min": 1,
          "max": 25
        }
      },
      "limits": {
        "maxTime": 2500
      },
      "faults": [
        {
          "at": 369,
          "type": "partition",
          "groups": [
            [
              "n1",
              "n3",
              "n4",
              "n5"
            ],
            [
              "n2"
            ]
          ]
        },
        {
          "at": 0,
          "type": "partition",
          "groups": [
            [
              "n3",
              "n4",
              "n5"
            ],
            [
              "n1",
              "n2"
            ]
          ]
        }
      ],
      "invariants": [
        {
          "id": "raft-election-safety",
          "version": "1"
        }
      ]
    },
    "expected": {
      "engineVersion": "0.4.0-cp4",
      "reason": "invariant-violation",
      "fingerprint": "ee240095",
      "violation": {
        "invariantId": "raft-election-safety",
        "time": 436,
        "nodes": [
          "n4",
          "n1"
        ],
        "observed": "Term 2 was led by n4 and also by n1",
        "eventNumber": 41
      }
    }
  },
  {
    "id": "cx-raft.volatile-term.raft-election-safety",
    "title": "raft-election/bug:volatile-term: a node that forgot its term adopts the old term again and votes in it a second time (found by fault exploration)",
    "source": "packages/protocols/test/counterexamples/raft.volatile-term.raft-election-safety.json",
    "format": "faultlab-counterexample/2",
    "spec": {
      "format": "faultlab-experiment/1",
      "seed": 3393420544,
      "nodes": [
        "n1",
        "n2",
        "n3"
      ],
      "protocol": {
        "name": "raft-election/bug:volatile-term",
        "version": "1",
        "options": {}
      },
      "network": {
        "latency": {
          "min": 1,
          "max": 10
        }
      },
      "limits": {
        "maxTime": 2500
      },
      "faults": [
        {
          "at": 950,
          "type": "recover",
          "node": "n3"
        },
        {
          "at": 900,
          "type": "crash",
          "node": "n1"
        },
        {
          "at": 1104,
          "type": "recover",
          "node": "n1"
        },
        {
          "at": 0,
          "type": "link",
          "from": "n2",
          "to": "n3",
          "loss": 0.2
        },
        {
          "at": 0,
          "type": "crash",
          "node": "n3"
        }
      ],
      "invariants": [
        {
          "id": "raft-election-safety",
          "version": "1"
        }
      ]
    },
    "expected": {
      "engineVersion": "0.4.0-cp4",
      "reason": "invariant-violation",
      "fingerprint": "1f70322d",
      "violation": {
        "invariantId": "raft-election-safety",
        "time": 1113,
        "nodes": [
          "n1",
          "n3"
        ],
        "observed": "Term 1 was led by n1 and also by n3",
        "eventNumber": 73
      }
    }
  },
  {
    "id": "cx-raft.volatile-term.raft-term-monotonic",
    "title": "raft-election/bug:volatile-term: currentTerm is lost on a crash and restarts at 0 (found by fault exploration)",
    "source": "packages/protocols/test/counterexamples/raft.volatile-term.raft-term-monotonic.json",
    "format": "faultlab-counterexample/2",
    "spec": {
      "format": "faultlab-experiment/1",
      "seed": 4259442735,
      "nodes": [
        "n1",
        "n2",
        "n3",
        "n4"
      ],
      "protocol": {
        "name": "raft-election/bug:volatile-term",
        "version": "1",
        "options": {}
      },
      "network": {
        "latency": {
          "min": 1,
          "max": 25
        }
      },
      "limits": {
        "maxTime": 2500
      },
      "faults": [
        {
          "at": 211,
          "type": "crash",
          "node": "n2"
        },
        {
          "at": 211,
          "type": "recover",
          "node": "n2"
        }
      ],
      "invariants": [
        {
          "id": "raft-term-monotonic",
          "version": "1"
        }
      ]
    },
    "expected": {
      "engineVersion": "0.4.0-cp4",
      "reason": "invariant-violation",
      "fingerprint": "63a86602",
      "violation": {
        "invariantId": "raft-term-monotonic",
        "time": 211,
        "nodes": [
          "n2"
        ],
        "observed": "currentTerm went from 1 to 0 (incarnation 2)",
        "eventNumber": 7
      }
    }
  },
  {
    "id": "cx-raft.volatile-voted-for.raft-election-safety",
    "title": "raft-election/bug:volatile-voted-for: a node that forgot its vote helps a second candidate win the same term (found by fault exploration)",
    "source": "packages/protocols/test/counterexamples/raft.volatile-voted-for.raft-election-safety.json",
    "format": "faultlab-counterexample/2",
    "spec": {
      "format": "faultlab-experiment/1",
      "seed": 3393420544,
      "nodes": [
        "n1",
        "n2",
        "n3"
      ],
      "protocol": {
        "name": "raft-election/bug:volatile-voted-for",
        "version": "1",
        "options": {}
      },
      "network": {
        "latency": {
          "min": 1,
          "max": 10
        }
      },
      "limits": {
        "maxTime": 2500
      },
      "faults": [
        {
          "at": 950,
          "type": "recover",
          "node": "n3"
        },
        {
          "at": 900,
          "type": "crash",
          "node": "n1"
        },
        {
          "at": 1104,
          "type": "recover",
          "node": "n1"
        },
        {
          "at": 0,
          "type": "link",
          "from": "n2",
          "to": "n3",
          "loss": 0.2
        },
        {
          "at": 0,
          "type": "crash",
          "node": "n3"
        }
      ],
      "invariants": [
        {
          "id": "raft-election-safety",
          "version": "1"
        }
      ]
    },
    "expected": {
      "engineVersion": "0.4.0-cp4",
      "reason": "invariant-violation",
      "fingerprint": "dd636e7e",
      "violation": {
        "invariantId": "raft-election-safety",
        "time": 1113,
        "nodes": [
          "n1",
          "n3"
        ],
        "observed": "Term 1 was led by n1 and also by n3",
        "eventNumber": 73
      }
    }
  },
  {
    "id": "cx-raft.volatile-voted-for.raft-one-vote-per-term",
    "title": "raft-election/bug:volatile-voted-for: votedFor is lost on a crash, so the node can vote again in the same term (found by fault exploration)",
    "source": "packages/protocols/test/counterexamples/raft.volatile-voted-for.raft-one-vote-per-term.json",
    "format": "faultlab-counterexample/2",
    "spec": {
      "format": "faultlab-experiment/1",
      "seed": 13,
      "nodes": [
        "n1",
        "n2",
        "n3"
      ],
      "protocol": {
        "name": "raft-election/bug:volatile-voted-for",
        "version": "1",
        "options": {
          "electionTimeout": {
            "min": 150,
            "max": 155
          }
        }
      },
      "network": {
        "latency": {
          "min": 1,
          "max": 10
        }
      },
      "limits": {
        "maxTime": 2500
      },
      "faults": [
        {
          "at": 151,
          "type": "crash",
          "node": "n1"
        },
        {
          "at": 151,
          "type": "recover",
          "node": "n1"
        }
      ],
      "invariants": [
        {
          "id": "raft-one-vote-per-term",
          "version": "1"
        }
      ]
    },
    "expected": {
      "engineVersion": "0.4.0-cp4",
      "reason": "invariant-violation",
      "fingerprint": "44ad6268",
      "violation": {
        "invariantId": "raft-one-vote-per-term",
        "time": 158,
        "nodes": [
          "n1",
          "n2"
        ],
        "observed": "n1 voted for n1 and then for n2 in term 1",
        "eventNumber": 10
      }
    }
  }
] as never;
