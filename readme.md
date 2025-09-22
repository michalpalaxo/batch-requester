# Batch requester

This is a custom script design to send batch request from Circularo.
This script was created as a workaround for the lack of support for
batch signing with 2 or more signatories in Circularo frontend

## Installation

1. Install NodeJS with NPM https://nodejs.org/en
2. Clone the repository
3. Install dependencies using `npm install`
4. Adjust configuration file - copy `config.example.json` into `config.json` and adjust the required variables
5. Create the source CSV file - supply the source data for the batch request into `data.csv`
6. Run using `node index.js`
