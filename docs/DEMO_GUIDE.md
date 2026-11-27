# Demo guide
1. Start FastAPI and Vite as in README.
2. Load the extension from `extension` after copying the Vite build into `extension/sidepanel`.
3. Open the portal at `http://localhost:5173/portal`.
4. In the side panel, ask to check property tax. Confirm Property Tax Assistance and the six-step workflow.
5. Enter `BBMP-2048` and a ward in Citizen Input. Select **Fill Portal Fields**; inspect the populated portal fields and click **Check Dues** manually. Demo due: ₹1,250.
6. Try **Simplify This Website**, **Restore Original Website**, and **Highlight This Field**. The cursor focuses the labeled property ID control without changing its value.
7. Review the amount, then start **Pay demo tax** from the portal yourself. Use **Next Step** in UAL to verify the receipt and persist checkpoints. Only the receipt reference and demo marker are sent for verification.
