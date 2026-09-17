import sys

from agent import run_agent


def main():

    if len(sys.argv) > 1:
        question = " ".join(sys.argv[1:])
    else:
        question = input(
            "DevOps Agent > "
        )

    result = run_agent(question)

    print("\n")
    print("=" * 70)
    print("DEVOPS AGENT RESULT")
    print("=" * 70)
    print(result)


if __name__ == "__main__":
    main()