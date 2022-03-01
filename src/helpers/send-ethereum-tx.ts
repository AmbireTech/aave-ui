import { Dispatch, SetStateAction } from 'react';
import { BigNumber, providers } from 'ethers';
import { eEthereumTxType, transactionType, GasResponse } from '@aave/protocol-js';
import { TransactionReceipt, TransactionResponse } from '@ethersproject/abstract-provider';
import WalletConnectProvider from '@walletconnect/web3-provider';

function hexToAscii(_hex: string): string {
  const hex = _hex.toString();
  let str = '';
  for (let n = 0; n < hex.length; n += 2) {
    str += String.fromCharCode(parseInt(hex.substr(n, 2), 16));
  }
  return str;
}

export enum TxStatusType {
  submitted = 'submitted',
  confirmed = 'confirmed',
  error = 'error',
}

export interface EthTransactionData {
  name: string;
  txType: eEthereumTxType;
  unsignedData?: () => Promise<transactionType>;
  gas: GasResponse;
  loading?: boolean;
  txStatus?: TxStatusType;
  txHash?: string;
  txReceipt?: TransactionReceipt;
  error?: string;
  rawTx?: {};
}

export interface SendEthTransactionCallbacks {
  onExecution?: (txHash: string) => void;
  onConfirmation?: (receipt: TransactionReceipt) => void;
}

export async function sendEthTransaction(
  txGetter: () => Promise<transactionType>,
  provider: providers.Web3Provider | undefined,
  stateSetter: Dispatch<SetStateAction<EthTransactionData>>,
  customGasPrice: string | null,
  callbacks?: SendEthTransactionCallbacks
) {
  if (!provider) return;

  stateSetter((state) => ({
    ...state,
    loading: true,
    txStatus: undefined,
    txHash: undefined,
    txReceipt: undefined,
    error: undefined,
  }));

  let extendedTxData: transactionType;
  try {
    extendedTxData = await txGetter();
    if (customGasPrice) extendedTxData.gasPrice = BigNumber.from(customGasPrice);
  } catch (e) {
    console.log('tx building error', e);
    stateSetter((state) => ({
      ...state,
      loading: false,
      error: e.message.toString(),
    }));
    return;
  }

  const { from, ...txData } = extendedTxData;
  const signer = provider.getSigner(from);
  let txResponse: TransactionResponse | undefined;
  try {
    txResponse = await signer.sendTransaction({
      ...txData,
      value: txData.value ? BigNumber.from(txData.value) : undefined,
    });
  } catch (e) {
    console.error('send-ethereum-tx', e);

    stateSetter((state) => ({
      ...state,
      loading: false,
      error: e.message.toString(),
    }));
    return;
  }

  const txHash = txResponse?.hash;

  if (!txHash) {
    stateSetter((state) => ({
      ...state,
      loading: false,
    }));
    return;
  }

  stateSetter((state) => ({
    ...state,
    txHash,
    txStatus: TxStatusType.submitted,
  }));

  // if onExecution callback provided - call it
  if (callbacks?.onExecution) {
    callbacks.onExecution(txResponse.hash);
  }

  try {
    const txReceipt = await txResponse.wait(1);
    stateSetter((state) => ({
      ...state,
      txReceipt,
      txStatus: TxStatusType.confirmed,
      loading: false,
    }));

    // if onConfirmation callback provided - call it
    if (callbacks?.onConfirmation) {
      callbacks.onConfirmation(txReceipt);
    }
  } catch (e) {
    let error = 'network error has occurred, please check tx status in an explorer';

    try {
      let tx = await provider.getTransaction(txResponse.hash);
      // @ts-ignore TODO: need think about "tx" type
      const code = await provider.call(tx, tx.blockNumber);
      error = hexToAscii(code.substr(138));
    } catch (e) {
      console.log('network error', e);
    }

    stateSetter((state) => ({
      ...state,
      error,
      txStatus: TxStatusType.error,
      loading: false,
    }));
  }
}

export async function sendEthBatchTransaction(
  txGetters: (() => Promise<transactionType>)[],
  provider: providers.Web3Provider | undefined,
  stateSetter: Dispatch<SetStateAction<EthTransactionData>>,
  customGasPrice: string | null,
  callbacks?: SendEthTransactionCallbacks
) {
  if (!provider) return;

  stateSetter((state) => ({
    ...state,
    loading: true,
    txStatus: undefined,
    txHash: undefined,
    txReceipt: undefined,
    error: undefined,
  }));

  const params: any[] = [];

  for (let txGetter of txGetters) {
    let extendedTxData: transactionType;
    try {
      extendedTxData = await txGetter();
      if (customGasPrice) extendedTxData.gasPrice = BigNumber.from(customGasPrice);

      const { ...txData } = extendedTxData;
      params.push({
        to: txData.to,
        data: txData.data,
      });
    } catch (e) {
      console.log('tx building error', e);
      stateSetter((state) => ({
        ...state,
        loading: false,
        error: e.message.toString(),
      }));
      return;
    }
  }

  /*params.push({
    to: params[0].to,
    data: params[0].data,
  });

  params[params.length - 1].data = params[params.length - 1].data.substr(0, params[params.length - 1].data.length - 64) + '0000000000000000000000000000000000000000000000000000000000000000';*/

  const wcProvider = provider.provider as WalletConnectProvider;

  const txResponse = await new Promise<TransactionResponse>((resolve, reject) => {
    wcProvider.connector
      .sendCustomRequest({
        method: 'ambire_sendBatchTransaction',
        params,
      })
      .then(async (res) => {
        resolve({
          hash: res,
          wait: (confirmations) => provider.waitForTransaction(res, confirmations),
        } as TransactionResponse);
      })
      .catch((err) => {
        console.error('send-ethereum-tx', err);

        stateSetter((state) => ({
          ...state,
          loading: false,
          error: err.message.toString(),
        }));
        return;
      });
  });

  if (!txResponse) return;

  const txHash = txResponse.hash;

  if (!txHash) {
    stateSetter((state) => ({
      ...state,
      loading: false,
    }));
    return;
  }

  stateSetter((state) => ({
    ...state,
    txHash,
    txStatus: TxStatusType.submitted,
  }));

  // if onExecution callback provided - call it
  if (callbacks?.onExecution) {
    callbacks.onExecution(txResponse.hash);
  }

  try {
    const txReceipt = await txResponse.wait(1);
    stateSetter((state) => ({
      ...state,
      txReceipt,
      txStatus: TxStatusType.confirmed,
      loading: false,
    }));

    // if onConfirmation callback provided - call it
    if (callbacks?.onConfirmation) {
      callbacks.onConfirmation(txReceipt);
    }
  } catch (e) {
    let error = 'network error has occurred, please check tx status in an explorer';

    try {
      let tx = await provider.getTransaction(txResponse.hash);
      // @ts-ignore TODO: need think about "tx" type
      const code = await provider.call(tx, tx.blockNumber);
      error = hexToAscii(code.substr(138));
    } catch (e) {
      console.log('network error', e);
    }

    stateSetter((state) => ({
      ...state,
      error,
      txStatus: TxStatusType.error,
      loading: false,
    }));
  }
}
