"""PyInstaller entrypoint: use an absolute import so frozen imports resolve."""
from cnie_capture.__main__ import main

if __name__ == "__main__":
    main()
